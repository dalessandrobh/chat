/**
 * Serviço de envio de mensagens.
 *
 * Único caminho de saída do sistema. Painel e n8n chamam daqui, nunca a API
 * do provedor direto. Concentrar aqui garante quatro coisas:
 *   1. toda mensagem enviada vira uma linha em chat.messages;
 *   2. a regra da janela de 24h é aplicada sempre, não por engano;
 *   3. falha do provedor fica registrada em vez de sumir;
 *   4. quem chama não precisa saber se o canal é Meta ou Evolution.
 *
 * O provedor é escolhido pelo canal da conversa, não por configuração global:
 * dois números de provedores diferentes convivem no mesmo painel.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  MetaApiError,
  buildTemplateComponents,
  sendMedia,
  sendTemplate,
  sendText,
  type MediaKind,
} from "@/lib/meta/client";
import {
  EvolutionApiError,
  sendMedia as evoSendMedia,
  sendText as evoSendText,
  type EvolutionMediaType,
} from "@/lib/evolution/client";

export type SendOutcome =
  | { ok: true; messageId: string; waMessageId: string }
  | { ok: false; reason: "outside_window"; message: string }
  | { ok: false; reason: "not_found"; message: string }
  | { ok: false; reason: "template_not_approved"; message: string }
  | { ok: false; reason: "disconnected"; message: string }
  | { ok: false; reason: "invalid_number"; message: string }
  | { ok: false; reason: "meta_error"; message: string; code?: number };

type Provider = "meta_cloud" | "evolution";

interface ConversationRow {
  id: string;
  channel_id: string;
  window_expires_at: string | null;
  contacts: { wa_id: string } | null;
  channels: { provider: Provider; instance_name: string | null } | null;
}

async function loadConversation(conversationId: string): Promise<ConversationRow | null> {
  const { data } = await supabaseAdmin()
    .from("conversations")
    .select(
      "id, channel_id, window_expires_at, contacts(wa_id), channels(provider, instance_name)"
    )
    .eq("id", conversationId)
    .maybeSingle();

  return (data as ConversationRow | null) ?? null;
}

function providerOf(conversation: ConversationRow): Provider {
  return conversation.channels?.provider ?? "meta_cloud";
}

/**
 * Nome da instância na Evolution. A constraint channels_identity_check já
 * impede canal evolution sem instância; se chegou aqui nulo, o canal foi
 * criado por fora do painel.
 */
function instanceOf(conversation: ConversationRow): string {
  const instance = conversation.channels?.instance_name;
  if (!instance) {
    throw new Error(
      `Canal ${conversation.channel_id} é evolution mas não tem instance_name.`
    );
  }
  return instance;
}

/**
 * A janela de 24h é regra da Meta, não do WhatsApp: em canal evolution não
 * existe restrição de horário para texto livre.
 */
function isWithinWindow(conversation: ConversationRow): boolean {
  if (providerOf(conversation) === "evolution") return true;
  if (!conversation.window_expires_at) return false;
  return new Date(conversation.window_expires_at) > new Date();
}

// -----------------------------------------------------------------------------
// Despacho por provedor — o único ponto do arquivo que sabe a diferença
// -----------------------------------------------------------------------------

async function dispatchText(
  conversation: ConversationRow,
  to: string,
  text: string,
  replyTo?: string
): Promise<string | null> {
  if (providerOf(conversation) === "evolution") {
    const result = await evoSendText(instanceOf(conversation), to, text, {
      quotedId: replyTo,
    });
    return result.key?.id ?? null;
  }

  const result = await sendText(to, text, { replyTo });
  return result.messages?.[0]?.id ?? null;
}

/** Os nomes de tipo de mídia não coincidem entre os dois provedores. */
const EVOLUTION_MEDIA_TYPE: Record<string, EvolutionMediaType> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  sticker: "image",
};

async function dispatchMedia(
  conversation: ConversationRow,
  to: string,
  input: { kind: MediaKind; link?: string; mediaId?: string; caption?: string; filename?: string }
): Promise<string | null> {
  if (providerOf(conversation) === "evolution") {
    // A Evolution não tem upload prévio: ou é URL pública, ou é base64.
    const media = input.link ?? input.mediaId;
    if (!media) {
      throw new Error("Canal evolution exige `link` (URL pública) ou base64 na mídia.");
    }
    const result = await evoSendMedia(instanceOf(conversation), to, {
      mediatype: EVOLUTION_MEDIA_TYPE[input.kind] ?? "document",
      media,
      caption: input.caption,
      fileName: input.filename,
    });
    return result.key?.id ?? null;
  }

  const result = await sendMedia(to, input.kind, {
    link: input.link,
    id: input.mediaId,
    caption: input.caption,
    filename: input.filename,
  });
  return result.messages?.[0]?.id ?? null;
}

/** Grava a mensagem que acabou de sair. */
async function recordOutbound(input: {
  conversationId: string;
  channelId: string;
  waMessageId: string | null;
  type: string;
  body: string | null;
  payload: Record<string, unknown>;
  author: "bot" | "agent" | "system";
  agentId?: string | null;
  templateId?: string | null;
  templateVariables?: string[] | null;
  status: "sent" | "failed";
  error?: Record<string, unknown> | null;
}): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      channel_id: input.channelId,
      direction: "out",
      wa_message_id: input.waMessageId,
      type: input.type,
      body: input.body,
      payload: input.payload,
      author: input.author,
      agent_id: input.agentId ?? null,
      template_id: input.templateId ?? null,
      template_variables: input.templateVariables ?? null,
      status: input.status,
      error: input.error ?? null,
      sent_at: input.status === "sent" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao gravar mensagem: ${error.message}`);
  return data.id as string;
}

// -----------------------------------------------------------------------------
// Texto livre
// -----------------------------------------------------------------------------

export async function sendTextMessage(input: {
  conversationId: string;
  text: string;
  author: "bot" | "agent" | "system";
  agentId?: string | null;
  replyTo?: string;
}): Promise<SendOutcome> {
  const conversation = await loadConversation(input.conversationId);
  if (!conversation?.contacts?.wa_id) {
    return { ok: false, reason: "not_found", message: "Conversa não encontrada" };
  }

  // Barreira antes de gastar uma chamada à Meta que já sabemos que falharia.
  if (!isWithinWindow(conversation)) {
    return {
      ok: false,
      reason: "outside_window",
      message:
        "A janela de 24h expirou. Use um template aprovado para reabrir a conversa.",
    };
  }

  try {
    const waMessageId = await dispatchText(
      conversation,
      conversation.contacts.wa_id,
      input.text,
      input.replyTo
    );

    const messageId = await recordOutbound({
      conversationId: conversation.id,
      channelId: conversation.channel_id,
      waMessageId,
      type: "text",
      body: input.text,
      payload: { text: { body: input.text } },
      author: input.author,
      agentId: input.agentId,
      status: "sent",
    });

    return { ok: true, messageId, waMessageId: waMessageId ?? "" };
  } catch (err) {
    return handleSendFailure(err, {
      conversationId: conversation.id,
      channelId: conversation.channel_id,
      type: "text",
      body: input.text,
      author: input.author,
      agentId: input.agentId,
    });
  }
}

// -----------------------------------------------------------------------------
// Template — o único jeito de falar fora da janela de 24h
// -----------------------------------------------------------------------------

export async function sendTemplateMessage(input: {
  conversationId: string;
  templateId: string;
  variables?: string[];
  author: "bot" | "agent";
  agentId?: string | null;
}): Promise<SendOutcome> {
  const conversation = await loadConversation(input.conversationId);
  if (!conversation?.contacts?.wa_id) {
    return { ok: false, reason: "not_found", message: "Conversa não encontrada" };
  }

  const { data: template } = await supabaseAdmin()
    .from("templates")
    .select("id, name, language, status, variable_count, components")
    .eq("id", input.templateId)
    .maybeSingle();

  if (!template) {
    return { ok: false, reason: "not_found", message: "Template não encontrado" };
  }

  const provider = providerOf(conversation);

  // Enviar template não aprovado sempre falha na Meta e ainda conta como erro
  // na qualidade do número. Melhor barrar aqui.
  //
  // Em canal evolution não existe aprovação: o template é só uma mensagem
  // pronta com {{n}}, que vai pelo mesmo caminho de um texto qualquer. O
  // status LOCAL é o normal ali, e barrá-lo tornaria a tela de templates
  // inútil para esse canal.
  if (provider === "meta_cloud" && template.status !== "APPROVED") {
    return {
      ok: false,
      reason: "template_not_approved",
      message: `O template "${template.name}" está com status ${template.status}. Só APPROVED pode ser enviado.`,
    };
  }

  const variables = input.variables ?? [];
  if (variables.length !== template.variable_count) {
    return {
      ok: false,
      reason: "meta_error",
      message: `O template "${template.name}" espera ${template.variable_count} variável(is), recebeu ${variables.length}.`,
    };
  }

  // Substitui {{1}}, {{2}}... pelos valores reais. Na Meta serve de preview
  // no inbox; na Evolution é a mensagem de verdade.
  const bodyText = renderTemplatePreview(template.components, variables);

  try {
    let waMessageId: string | null;

    if (provider === "evolution") {
      waMessageId = await dispatchText(conversation, conversation.contacts.wa_id, bodyText);
    } else {
      const result = await sendTemplate(
        conversation.contacts.wa_id,
        template.name,
        template.language,
        buildTemplateComponents(variables)
      );
      waMessageId = result.messages?.[0]?.id ?? null;
    }

    const messageId = await recordOutbound({
      conversationId: conversation.id,
      channelId: conversation.channel_id,
      waMessageId,
      type: "template",
      body: bodyText,
      payload: { template: { name: template.name, language: template.language } },
      author: input.author,
      agentId: input.agentId,
      templateId: template.id,
      templateVariables: variables,
      status: "sent",
    });

    return { ok: true, messageId, waMessageId: waMessageId ?? "" };
  } catch (err) {
    return handleSendFailure(err, {
      conversationId: conversation.id,
      channelId: conversation.channel_id,
      type: "template",
      body: template.name,
      author: input.author,
      agentId: input.agentId,
      templateId: template.id,
    });
  }
}

/** Troca {{n}} pelos valores, para o inbox mostrar o texto final. */
export function renderTemplatePreview(
  components: Array<Record<string, any>> | null,
  variables: string[]
): string {
  const body = (components ?? []).find(
    (c) => String(c.type).toUpperCase() === "BODY"
  );
  let text: string = body?.text ?? "";
  variables.forEach((value, index) => {
    text = text.replaceAll(`{{${index + 1}}}`, value);
  });
  return text;
}

// -----------------------------------------------------------------------------
// Mídia
// -----------------------------------------------------------------------------

export async function sendMediaMessage(input: {
  conversationId: string;
  kind: MediaKind;
  link?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
  author: "bot" | "agent" | "system";
  agentId?: string | null;
}): Promise<SendOutcome> {
  const conversation = await loadConversation(input.conversationId);
  if (!conversation?.contacts?.wa_id) {
    return { ok: false, reason: "not_found", message: "Conversa não encontrada" };
  }
  if (!isWithinWindow(conversation)) {
    return {
      ok: false,
      reason: "outside_window",
      message: "A janela de 24h expirou. Envie um template antes.",
    };
  }

  try {
    const waMessageId = await dispatchMedia(conversation, conversation.contacts.wa_id, {
      kind: input.kind,
      link: input.link,
      mediaId: input.mediaId,
      caption: input.caption,
      filename: input.filename,
    });

    const messageId = await recordOutbound({
      conversationId: conversation.id,
      channelId: conversation.channel_id,
      waMessageId,
      type: input.kind,
      body: input.caption ?? null,
      payload: { link: input.link, id: input.mediaId, filename: input.filename },
      author: input.author,
      agentId: input.agentId,
      status: "sent",
    });

    return { ok: true, messageId, waMessageId: waMessageId ?? "" };
  } catch (err) {
    return handleSendFailure(err, {
      conversationId: conversation.id,
      channelId: conversation.channel_id,
      type: input.kind,
      body: input.caption ?? null,
      author: input.author,
      agentId: input.agentId,
    });
  }
}

// -----------------------------------------------------------------------------
// Erro de envio: registra a falha antes de devolver
// -----------------------------------------------------------------------------

async function handleSendFailure(
  err: unknown,
  ctx: {
    conversationId: string;
    channelId: string;
    type: string;
    body: string | null;
    author: "bot" | "agent" | "system";
    agentId?: string | null;
    templateId?: string | null;
  }
): Promise<SendOutcome> {
  const isMeta = err instanceof MetaApiError;
  const isEvolution = err instanceof EvolutionApiError;

  const details = isMeta
    ? { code: err.details?.code, message: err.message, subcode: err.details?.error_subcode }
    : isEvolution
      ? { code: err.status, message: err.message, provider: "evolution" }
      : { message: err instanceof Error ? err.message : String(err) };

  // A mensagem falhada continua visível no painel — o agente precisa saber.
  await recordOutbound({
    conversationId: ctx.conversationId,
    channelId: ctx.channelId,
    waMessageId: null,
    type: ctx.type,
    body: ctx.body,
    payload: {},
    author: ctx.author,
    agentId: ctx.agentId,
    templateId: ctx.templateId,
    status: "failed",
    error: details,
  }).catch(() => {
    /* já estamos num caminho de erro; não mascarar a causa original */
  });

  if (isMeta && err.isOutsideWindow) {
    return {
      ok: false,
      reason: "outside_window",
      message: "A Meta recusou: fora da janela de 24h. Use um template.",
    };
  }

  // Sessão caída é o erro característico da Evolution e não se resolve
  // retentando: alguém tem que ler o QR de novo. A mensagem tem que dizer
  // isso, senão o atendente fica clicando em enviar.
  if (isEvolution && err.isDisconnected) {
    return {
      ok: false,
      reason: "disconnected",
      message:
        "O WhatsApp desconectou desta instância. Reconecte lendo o QR em Canais.",
    };
  }

  // Número sem WhatsApp não é falha de envio, é dado errado na base. A
  // distinção importa: um vira `no_whatsapp`, o outro `send_failed`, e só o
  // segundo sugere que o número está sendo rejeitado.
  if (isEvolution && err.isInvalidNumber) {
    return {
      ok: false,
      reason: "invalid_number",
      message: "Este número não tem WhatsApp.",
    };
  }

  return {
    ok: false,
    reason: "meta_error",
    message: details.message ?? "Falha ao enviar",
    code: isMeta ? err.details?.code : isEvolution ? err.status : undefined,
  };
}
