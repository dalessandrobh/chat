/**
 * Webhook da Evolution API.
 *
 * Mesma disciplina do webhook da Meta — responder 200 rápido, idempotência
 * por conta própria, erro nosso não vira 500 — com três diferenças:
 *
 *   - autenticação por bearer, porque a Evolution não assina o corpo;
 *   - chega mensagem que o DONO mandou pelo celular (`fromMe`), que precisa
 *     aparecer no painel e não pode acionar o bot;
 *   - chega estado da sessão, que é o que avisa quando o pareamento cai.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { sendTextMessage } from "@/lib/messages";
import { CONFIRMACAO_SAIDA, pediuParaSair } from "@/lib/opt-out";
import {
  parseWebhook,
  verifyWebhookToken,
  type EvoConnectionUpdate,
  type EvoInboundMessage,
  type EvoStatusUpdate,
} from "@/lib/evolution/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyWebhookToken(request.headers.get("authorization"))) {
    return new NextResponse("Não autorizado", { status: 401 });
  }

  let events;
  try {
    events = parseWebhook(await request.json());
  } catch (err) {
    console.error("[evolution] payload ilegível", err);
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
        case "connection":
          await handleConnectionUpdate(event);
          break;
      }
    } catch (err) {
      console.error(`[evolution] falha ao processar ${event.kind}`, err);
    }
  }

  return NextResponse.json({ ok: true });
}

// -----------------------------------------------------------------------------
// Mensagem
// -----------------------------------------------------------------------------

async function handleInboundMessage(event: EvoInboundMessage) {
  const db = supabaseAdmin();

  // 1. Idempotência: a Evolution reentrega em caso de timeout, e o Baileys
  //    reemite a mesma mensagem quando a sessão reconecta.
  const { error: dedupeError } = await db.from("webhook_events").insert({
    provider: "evolution",
    event_key: event.waMessageId,
    event_type: "messages.upsert",
    payload: event.payload,
  });

  if (dedupeError) {
    if (dedupeError.code === "23505") return;
    throw dedupeError;
  }

  // 2. Canal pela instância
  const { data: channel } = await db
    .from("channels")
    .select("id")
    .eq("instance_name", event.instanceName)
    .maybeSingle();

  if (!channel) {
    throw new Error(
      `Mensagem da instância desconhecida: ${event.instanceName}. ` +
        `Cadastre o canal em chat.channels.`
    );
  }

  // 3. Contato + conversa.
  //
  //    Em mensagem `fromMe` o pushName é o nome do DONO, não o do cliente —
  //    gravá-lo renomearia o contato para "Você". Por isso o nome só vem
  //    junto quando quem falou foi o cliente.
  const { data: conversationId, error: resolveError } = await db.rpc("resolve_conversation", {
    p_channel_id: channel.id,
    p_wa_id: event.from,
    p_profile_name: event.fromMe ? null : event.profileName,
  });
  if (resolveError) throw resolveError;

  // 4. Persistir.
  //
  //    `fromMe` é a mensagem que o dono digitou no celular ou no WhatsApp Web
  //    — o cenário que a API oficial não permite e que motiva usar a
  //    Evolution. Ela entra como saída, autoria `agent`, para o histórico do
  //    painel bater com o do aparelho.
  const outbound = event.fromMe;

  const { error: messageError } = await db.from("messages").insert({
    conversation_id: conversationId,
    channel_id: channel.id,
    direction: outbound ? "out" : "in",
    wa_message_id: event.waMessageId,
    type: event.type,
    body: event.body,
    payload: event.payload,
    media: event.media,
    author: outbound ? "agent" : "contact",
    status: outbound ? "sent" : "delivered",
    replied_to_wa_id: event.repliedTo,
    created_at: event.timestamp.toISOString(),
  });
  if (messageError) throw messageError;

  await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "evolution")
    .eq("event_key", event.waMessageId);

  // Pedido de saída tem precedência sobre tudo: nem bot responde, nem
  // campanha alcança de novo.
  if (!outbound && pediuParaSair(event.body)) {
    await handleOptOut(conversationId as string, event.from);
    return;
  }

  if (outbound) {
    // O dono respondeu pelo celular. Deixar o bot seguir depois disso seria
    // duas vozes na mesma conversa, então a resposta manual vale como
    // "assumi esta conversa" — igual a clicar em Assumir no painel.
    await db.rpc("take_over_external", {
      p_conversation_id: conversationId,
      p_reason: "Resposta manual pelo WhatsApp",
    });

    // Se ele já respondeu, já leu. Sem isso a conversa ficaria marcada como
    // não lida no painel até alguém abrir uma mensagem que não existe mais.
    await db.from("conversations").update({ unread_count: 0 }).eq("id", conversationId);
    return;
  }

  // 5. Bot só é acionado em modo bot.
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
 * Tira da lista e confirma para a pessoa.
 *
 * A confirmação não é gentileza: sem resposta, quem pediu para sair repete o
 * pedido — e a segunda tentativa costuma ser o botão de denunciar.
 */
async function handleOptOut(conversationId: string, waId: string) {
  const db = supabaseAdmin();

  const { error } = await db.rpc("opt_out", { p_wa_id: waId, p_reason: "opt_out" });
  if (error) console.error("[opt-out] falha ao remover da lista", error);

  const enviada = await sendTextMessage({
    conversationId,
    text: CONFIRMACAO_SAIDA,
    author: "system",
  });
  if (!enviada.ok) {
    console.error(`[opt-out] confirmação não enviada: ${enviada.message}`);
  }
}

async function forwardToN8n(conversationId: string, event: EvoInboundMessage) {
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
        provider: "evolution",
        waMessageId: event.waMessageId,
        from: event.from,
        profileName: event.profileName,
        type: event.type,
        text: event.body,
        // O base64 da mídia não vai para o n8n: engordaria o payload à toa.
        // Quem precisar busca em /chat/getBase64FromMediaMessage.
        hasMedia: Boolean(event.media),
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
    console.error("[evolution] n8n indisponível", err);
  }
}

// -----------------------------------------------------------------------------
// Status de entrega
// -----------------------------------------------------------------------------

const STATUS_TIMESTAMP_COLUMN = {
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
} as const;

async function handleStatusUpdate(event: EvoStatusUpdate) {
  const patch: Record<string, unknown> = { status: event.status };

  const column = STATUS_TIMESTAMP_COLUMN[event.status as keyof typeof STATUS_TIMESTAMP_COLUMN];
  if (column) patch[column] = event.timestamp.toISOString();

  const db = supabaseAdmin();
  await db.from("messages").update(patch).eq("wa_message_id", event.waMessageId);

  // A mesma confirmação resolve o destinatário da campanha. É por existir este
  // retorno que o painel não precisa de um status "inconclusivo": todo envio
  // aceito termina entregue, lido ou falhado.
  const destino: Record<string, unknown> = { status: event.status };
  if (event.status === "delivered") destino.delivered_at = event.timestamp.toISOString();
  if (event.status === "read") destino.read_at = event.timestamp.toISOString();
  if (event.status === "failed") destino.failed_at = event.timestamp.toISOString();

  await db
    .from("campaign_recipients")
    .update(destino)
    .eq("wa_message_id", event.waMessageId);
}

// -----------------------------------------------------------------------------
// Estado da sessão
// -----------------------------------------------------------------------------

async function handleConnectionUpdate(event: EvoConnectionUpdate) {
  await supabaseAdmin()
    .from("channels")
    .update({
      connection_state: event.state,
      ...(event.state === "open" ? { connected_at: new Date().toISOString() } : {}),
    })
    .eq("instance_name", event.instanceName);

  if (event.state === "close") {
    // Sessão caída significa cliente sem resposta e ninguém sabendo. Log
    // agora; alerta no painel vem junto com a tela de Canais.
    console.error(`[evolution] instância ${event.instanceName} desconectou`);
  }
}
