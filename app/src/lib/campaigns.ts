/**
 * Motor de envio das campanhas.
 *
 * Um envio por vez, sempre. O banco decide QUEM e QUANDO — janela de horário,
 * teto diário e intervalo sorteado vivem em chat.claim_next_send(); aqui só
 * acontece a chamada ao WhatsApp e a anotação do resultado.
 *
 * A divisão importa: as travas que protegem o número precisam valer para
 * qualquer coisa que dispare, inclusive um script rodado na mão às três da
 * manhã. Deixá-las no banco é o que garante isso.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendMediaMessage, sendTextMessage } from "@/lib/messages";
import type { MediaKind } from "@/lib/meta/client";

interface Claim {
  recipient_id: string;
  campaign_id: string;
  channel_id: string;
  company_id: string;
  wa_id: string;
  name: string;
  media_kind: "text" | "image" | "video" | "audio" | "document";
  body: string | null;
  media_url: string | null;
  media_filename: string | null;
  media_mime: string | null;
}

export interface TickResult {
  enviados: number;
  falhas: number;
  /** Null quando não havia nada a fazer — sem campanha corrente ou fora da hora. */
  motivo?: string;
}

/**
 * `{nome}` é a única substituição aceita.
 *
 * Mensagem idêntica para centenas de números é o padrão que sistemas
 * antifraude mais reconhecem; variar ao menos o nome já quebra a assinatura,
 * além de soar como gente.
 */
function render(texto: string | null, nome: string): string {
  return (texto ?? "").replaceAll("{nome}", nome.split(" ")[0] ?? nome);
}

async function enviarUm(claim: Claim): Promise<boolean> {
  const db = supabaseAdmin();

  // Contato e conversa: a campanha aparece na thread do cliente como qualquer
  // outra mensagem, e não numa caixa paralela que ninguém olha.
  const { data: conversationId, error: resolveError } = await db.rpc("resolve_conversation", {
    p_channel_id: claim.channel_id,
    p_wa_id: claim.wa_id,
    p_profile_name: claim.name,
  });
  if (resolveError) throw resolveError;

  const texto = render(claim.body, claim.name);

  const resultado =
    claim.media_kind === "text"
      ? await sendTextMessage({
          conversationId: conversationId as string,
          text: texto,
          author: "system",
        })
      : await sendMediaMessage({
          conversationId: conversationId as string,
          kind: claim.media_kind as MediaKind,
          link: claim.media_url ?? undefined,
          caption: texto || undefined,
          filename: claim.media_filename ?? undefined,
          author: "system",
        });

  if (resultado.ok) {
    await db
      .from("campaign_recipients")
      .update({ wa_message_id: resultado.waMessageId, message_id: resultado.messageId })
      .eq("id", claim.recipient_id);
    return true;
  }

  await db
    .from("campaign_recipients")
    .update({ status: "failed", failed_at: new Date().toISOString(), error: resultado.message })
    .eq("id", claim.recipient_id);

  // Falha de sessão é do canal, não do número: insistir com este contato não
  // resolve nada e tirá-lo da base seria injusto com ele.
  if (resultado.reason !== "disconnected") {
    await db.rpc("opt_out", {
      p_company_id: claim.company_id,
      p_wa_id: claim.wa_id,
      // Guardar o motivo certo é o que permite, depois, separar "a base tem
      // números errados" de "o WhatsApp está recusando meus envios" — só o
      // segundo é sinal de que o número está queimando.
      p_reason: resultado.reason === "invalid_number" ? "no_whatsapp" : "send_failed",
    });
  }

  return false;
}

/**
 * Um passo do relógio. Envia no máximo uma mensagem — o intervalo entre elas é
 * a proteção, então acelerar aqui anularia o resto.
 */
export async function tick(): Promise<TickResult> {
  const { data, error } = await supabaseAdmin().rpc("claim_next_send");
  if (error) throw error;

  const claim = (data as Claim[] | null)?.[0];
  if (!claim) return { enviados: 0, falhas: 0, motivo: "nada a enviar agora" };

  try {
    const ok = await enviarUm(claim);
    return { enviados: ok ? 1 : 0, falhas: ok ? 0 : 1 };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    await supabaseAdmin()
      .from("campaign_recipients")
      .update({ status: "failed", failed_at: new Date().toISOString(), error: mensagem })
      .eq("id", claim.recipient_id);
    console.error("[campanha] falha inesperada", err);
    return { enviados: 0, falhas: 1 };
  }
}
