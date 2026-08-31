/**
 * Webhook da WhatsApp Cloud API.
 *
 * Regras que a Meta impõe e que moldam este arquivo:
 *   - responder 200 rápido; demorar faz a Meta reentregar e, na insistência,
 *     desativar a assinatura;
 *   - qualquer resposta != 200 vira reentrega, então erro nosso NÃO pode
 *     virar 500 — registramos e devolvemos 200;
 *   - a mesma mensagem pode chegar mais de uma vez; a idempotência é nossa.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import {
  parseWebhook,
  verifyChallenge,
  verifySignature,
  type InboundMessage,
  type StatusUpdate,
  type TemplateStatusUpdate,
} from "@/lib/meta/webhook";

// Precisa do corpo cru para validar a assinatura HMAC.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -----------------------------------------------------------------------------
// GET — handshake de verificação da URL no painel da Meta
// -----------------------------------------------------------------------------

export async function GET(request: Request) {
  const challenge = verifyChallenge(new URL(request.url).searchParams);

  if (!challenge) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  // A Meta espera o challenge como texto puro, sem aspas de JSON.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

// -----------------------------------------------------------------------------
// POST — eventos
// -----------------------------------------------------------------------------

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    // Aqui sim recusamos: não veio da Meta.
    return new NextResponse("Assinatura inválida", { status: 401 });
  }

  let events;
  try {
    events = parseWebhook(JSON.parse(rawBody));
  } catch (err) {
    console.error("[webhook] payload ilegível", err);
    return NextResponse.json({ ok: true });
  }

  for (const event of events) {
    try {
      switch (event.kind) {
        case "message":
          await handleInboundMessage(event);
          break;
        case "status":
          await handleStatusUpdate(event);
          break;
        case "template_status":
          await handleTemplateStatus(event);
          break;
      }
    } catch (err) {
      // Um evento ruim não pode derrubar o lote inteiro nem gerar reentrega
      // dos que já processamos.
      console.error(`[webhook] falha ao processar evento ${event.kind}`, err);
    }
  }

  return NextResponse.json({ ok: true });
}

// -----------------------------------------------------------------------------
// Mensagem recebida
// -----------------------------------------------------------------------------

async function handleInboundMessage(event: InboundMessage) {
  const db = supabaseAdmin();

  // 1. Idempotência. A constraint única em (provider, event_key) é a barreira
  //    real; um conflito aqui significa que já processamos esta mensagem.
  const { error: dedupeError } = await db.from("webhook_events").insert({
    event_key: event.waMessageId,
    event_type: "messages",
    payload: event.payload,
  });

  if (dedupeError) {
    if (dedupeError.code === "23505") return; // duplicata: ignorar em silêncio
    throw dedupeError;
  }

  // 2. Canal correspondente ao número que recebeu
  const { data: channel } = await db
    .from("channels")
    .select("id, company_id")
    .eq("phone_number_id", event.phoneNumberId)
    .maybeSingle();

  if (!channel) {
    throw new Error(
      `Mensagem para phone_number_id desconhecido: ${event.phoneNumberId}. ` +
        `Cadastre o canal em chat.channels.`
    );
  }

  // 3. Contato + conversa, numa chamada só e idempotente
  const { data: conversationId, error: resolveError } = await db.rpc(
    "resolve_conversation",
    {
      p_channel_id: channel.id,
      p_wa_id: event.from,
      p_profile_name: event.profileName,
    }
  );
  if (resolveError) throw resolveError;

  // 4. Persistir a mensagem. O trigger cuida de reabrir a janela de 24h,
  //    do contador de não lidas e do preview.
  const { error: messageError } = await db.from("messages").insert({
    conversation_id: conversationId,
    channel_id: channel.id,
    // Dono da linha, vindo do canal identificado pelo phone_number_id.
    company_id: channel.company_id,
    direction: "in",
    wa_message_id: event.waMessageId,
    type: event.type,
    body: event.body,
    payload: event.payload,
    media: event.media,
    author: "contact",
    status: "delivered",
    replied_to_wa_id: event.repliedTo,
    created_at: event.timestamp.toISOString(),
  });
  if (messageError) throw messageError;

  await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_key", event.waMessageId);

  // 5. Encaminhar ao n8n SÓ se a conversa estiver em modo bot.
  //    É aqui que o "assumir conversa" faz efeito: em modo human o bot
  //    simplesmente não é acionado.
  const { data: conversation } = await db
    .from("conversations")
    .select("id, mode")
    .eq("id", conversationId)
    .maybeSingle();

  if (conversation?.mode === "bot") {
    void forwardToN8n(conversation.id, event);
  }
}

/**
 * Dispara a automação sem segurar a resposta para a Meta.
 * Falha aqui não perde a mensagem — ela já está gravada no banco.
 */
async function forwardToN8n(conversationId: string, event: InboundMessage) {
  if (!serverEnv.n8nWebhookUrl) return;

  try {
    const response = await fetch(serverEnv.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.serviceToken}`,
      },
      body: JSON.stringify({
        conversationId,
        waMessageId: event.waMessageId,
        from: event.from,
        profileName: event.profileName,
        type: event.type,
        text: event.body,
        payload: event.payload,
        receivedAt: event.timestamp.toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    // Sem isto, credencial errada no n8n vira silêncio absoluto: o webhook
    // devolve 200, a mensagem fica gravada, e ninguém responde ao cliente.
    // Foi exatamente assim que um 403 passou despercebido.
    if (!response.ok) {
      console.error(
        `[webhook] n8n recusou o encaminhamento: HTTP ${response.status} — ` +
          (await response.text().catch(() => "")).slice(0, 200)
      );
    }
  } catch (err) {
    console.error("[webhook] n8n indisponível", err);
  }
}

// -----------------------------------------------------------------------------
// Status de entrega das mensagens que enviamos
// -----------------------------------------------------------------------------

const STATUS_TIMESTAMP_COLUMN = {
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
} as const;

async function handleStatusUpdate(event: StatusUpdate) {
  const db = supabaseAdmin();

  // A empresa vem do número que confirmou, não do id da mensagem: id de
  // provedor é dado de fora, e sozinho alcançaria a linha de outra empresa.
  const { data: channel } = await db
    .from("channels")
    .select("company_id")
    .eq("phone_number_id", event.phoneNumberId ?? "")
    .maybeSingle();

  if (!channel) return;
  const companyId = channel.company_id as string;

  const patch: Record<string, unknown> = { status: event.status };

  const column = STATUS_TIMESTAMP_COLUMN[event.status as keyof typeof STATUS_TIMESTAMP_COLUMN];
  if (column) patch[column] = event.timestamp.toISOString();
  if (event.status === "failed" && event.error) patch.error = event.error;

  // Sem .single(): status pode chegar para mensagem que não é nossa
  // (ex.: enviada por outra ferramenta na mesma WABA).
  // Mesmo cuidado da Evolution: o id vem do provedor, e a empresa entra na
  // cláusula para o status de uma nunca alcançar a linha de outra.
  await db
    .from("messages")
    .update(patch)
    .eq("wa_message_id", event.waMessageId)
    .eq("company_id", companyId);
}

// -----------------------------------------------------------------------------
// Aprovação/rejeição de template pela Meta
// -----------------------------------------------------------------------------

const TEMPLATE_EVENT_TO_STATUS: Record<string, string> = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
  PENDING: "PENDING",
  PENDING_DELETION: "DISABLED",
};

async function handleTemplateStatus(event: TemplateStatusUpdate) {
  const status = TEMPLATE_EVENT_TO_STATUS[event.event?.toUpperCase()];
  if (!status) return;

  await supabaseAdmin()
    .from("templates")
    .update({
      status,
      rejected_reason: event.reason,
      last_synced_at: new Date().toISOString(),
    })
    .eq("name", event.templateName)
    .eq("language", event.language);
}
