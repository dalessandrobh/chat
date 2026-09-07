/**
 * O relógio dos prazos de conversa.
 *
 * Três regras, cada uma com o prazo da empresa: o atendente assumiu e sumiu, a
 * conversa volta para o bot; ninguém pegou a conversa da fila dentro do prazo,
 * ela volta para o bot com outra frase; e conversa parada há mais tempo ainda é
 * arquivada.
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
import { mensagemDevolveu, mensagemFilaExpirou } from "@/lib/handoff-messages";

type Acao = "devolvida" | "fila_expirada" | "encerrada";

interface Mudanca {
  conversa_id: string;
  empresa_id: string;
  empresa: string;
  acao: Acao;
}

/**
 * O que o cliente ouve em cada caso.
 *
 * Arquivar não avisa nada, e por isso não está aqui: encerrar é organização
 * interna, e mandar "encerramos seu atendimento" às três da manhã transforma
 * faxina em notificação.
 */
const AVISO: Partial<Record<Acao, (empresa: string) => string>> = {
  // O atendente sumiu: para o cliente, o atendimento humano simplesmente
  // acabou, e dizer isso basta.
  devolvida: mensagemDevolveu,
  // Ninguém veio: aqui o cliente precisa saber que a tentativa acabou, senão
  // conta o problema de novo achando que alguém ainda está a caminho.
  fila_expirada: mensagemFilaExpirou,
};

export async function aplicarPrazos(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("aplicar_prazos_de_conversa");

  if (error) {
    console.error("[prazos] falha ao aplicar", error);
    return 0;
  }

  const mudancas = (data ?? []) as Mudanca[];

  for (const m of mudancas) {
    const texto = AVISO[m.acao]?.(m.empresa);
    if (!texto) continue;

    const enviada = await sendTextMessage({
      conversationId: m.conversa_id,
      text: texto,
      author: "bot",
    });
    if (!enviada.ok) {
      console.error(`[prazos] aviso de ${m.acao} não enviado: ${enviada.message}`);
    }
  }

  const conta = (acao: Acao) => mudancas.filter((m) => m.acao === acao).length;
  if (mudancas.length > 0) {
    console.log(
      `[prazos] ${conta("devolvida")} devolvida(s) ao bot, ` +
        `${conta("fila_expirada")} sem quem assumisse, ${conta("encerrada")} encerrada(s)`
    );
  }

  return mudancas.length;
}
