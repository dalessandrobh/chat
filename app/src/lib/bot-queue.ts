/**
 * A fila de turnos do bot.
 *
 * No WhatsApp ninguém escreve um parágrafo: escreve "oi", "queria saber",
 * "sobre aquecedor solar" — três webhooks em cinco segundos. Encaminhando na
 * hora, o agente respondia três vezes, cada resposta em cima de meia pergunta.
 *
 * Então a mensagem de texto não vai direto para o n8n. Ela entra numa janela
 * deslizante: cada mensagem nova empurra o prazo, e quando o cliente para de
 * digitar o turno vence e o agente roda uma vez, com as três linhas juntas.
 *
 * Mídia não espera. O aviso de "não leio áudio" e a escalação que vem com ele
 * não podem ficar oito segundos parados atrás de uma janela — e a mídia já
 * significa, por si, que a conversa vai para uma pessoa.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import type { EvoInboundMessage } from "@/lib/evolution/webhook";

/** O que o n8n recebe. Mesmo formato de antes da fila existir. */
export type TurnoDoBot = {
  conversationId: string;
  provider: "evolution";
  waMessageId: string;
  from: string;
  profileName: string | null;
  type: string;
  text: string | null;
  hasMedia: boolean;
  receivedAt: string;
};

export function turnoDoBot(conversationId: string, event: EvoInboundMessage): TurnoDoBot {
  return {
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
  };
}

/** Põe o turno na janela. O banco decide o prazo e emenda o texto. */
export async function enfileirarTurno(turno: TurnoDoBot): Promise<void> {
  const { error } = await supabaseAdmin().rpc("enqueue_bot_turn", {
    p_conversation_id: turno.conversationId,
    p_payload: turno,
  });

  // Falhar aqui é o cliente ficar sem resposta, então não fica só no log:
  // manda na hora, sem janela, que é pior atendimento e não silêncio.
  if (error) {
    console.error("[lote] não consegui enfileirar, mandando direto", error);
    await enviarTurno(turno);
  }
}

/**
 * Recolhe o que venceu e dispara. Chamado pelo relógio do instrumentation.
 * Devolve quantos turnos saíram, que é o que o log mostra.
 */
export async function despacharTurnosVencidos(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("claim_due_bot_turns", { p_limite: 20 });

  if (error) {
    console.error("[lote] falha ao recolher turnos vencidos", error);
    return 0;
  }

  const turnos = (data ?? []) as { payload: TurnoDoBot; mensagens: number }[];

  for (const turno of turnos) {
    if (turno.mensagens > 1) {
      console.log(`[lote] ${turno.mensagens} mensagens viraram um turno só`);
    }
    await enviarTurno(turno.payload);
  }

  return turnos.length;
}

export async function enviarTurno(turno: TurnoDoBot): Promise<void> {
  if (!serverEnv.n8nWebhookUrl) return;

  try {
    const response = await fetch(serverEnv.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverEnv.serviceToken}`,
      },
      body: JSON.stringify(turno),
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
