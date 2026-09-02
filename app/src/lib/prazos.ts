/**
 * O relógio dos prazos de conversa.
 *
 * Duas regras, cada uma com o prazo da empresa: conversa parada em atendimento
 * humano volta para o bot, e conversa parada há mais tempo ainda é arquivada.
 *
 * Quem decide o que muda é o banco, numa consulta só — assim dois relógios
 * concorrentes não devolvem a mesma conversa duas vezes. Aqui só sobra avisar
 * o cliente de que voltou ao atendimento automático.
 *
 * Arquivar não avisa nada: encerrar é organização interna, e mandar "encerramos
 * seu atendimento" às três da manhã transforma faxina em notificação.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/messages";
import { mensagemDevolveu } from "@/lib/handoff-messages";

interface Mudanca {
  conversa_id: string;
  empresa_id: string;
  empresa: string;
  acao: "devolvida" | "encerrada";
}

export async function aplicarPrazos(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("aplicar_prazos_de_conversa");

  if (error) {
    console.error("[prazos] falha ao aplicar", error);
    return 0;
  }

  const mudancas = (data ?? []) as Mudanca[];

  for (const m of mudancas.filter((x) => x.acao === "devolvida")) {
    // Alguém pediu uma pessoa e ninguém veio. Voltar ao robô calado é pior do
    // que dizer que voltou.
    const enviada = await sendTextMessage({
      conversationId: m.conversa_id,
      text: mensagemDevolveu(m.empresa),
      author: "bot",
    });
    if (!enviada.ok) {
      console.error(`[prazos] aviso de devolução não enviado: ${enviada.message}`);
    }
  }

  const devolvidas = mudancas.filter((m) => m.acao === "devolvida").length;
  const encerradas = mudancas.filter((m) => m.acao === "encerrada").length;
  if (devolvidas || encerradas) {
    console.log(`[prazos] ${devolvidas} devolvida(s) ao bot, ${encerradas} encerrada(s)`);
  }

  return mudancas.length;
}
