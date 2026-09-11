/**
 * Conferir, antes de disparar, quais números existem no WhatsApp.
 *
 * Em 10/09/2026 uma campanha saiu por um número novo para 180 contatos. Das 86
 * mensagens que chegou a mandar, 20 foram para números que não existem — e
 * nove minutos depois o WhatsApp encerrou a sessão daquele número com
 * `statusReason: 401`. Lista com um quinto de inválidos é o sinal mais alto
 * que um antifraude procura: quem conhece os próprios contatos não erra 20 em
 * 86.
 *
 * Quem não existe sai da lista pelo caminho que já existia — `chat.opt_out`
 * com motivo `no_whatsapp` —, o mesmo por onde sairia ao falhar no disparo. A
 * diferença é sair antes, sem gastar a reputação do número para descobrir.
 *
 * Falhar aqui não derruba a campanha. A conferência é um ganho; sem ela o
 * mundo volta a ser o de antes, que é o mundo que funcionava — e recusar a
 * campanha porque a Evolution demorou seria trocar um risco por uma parede.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { credenciaisDoCanal, conexaoEvolution } from "@/lib/canais";
import { whatsappNumbers } from "@/lib/evolution/client";

/**
 * Quantos números por chamada.
 *
 * A Evolution pergunta ao WhatsApp um a um por baixo do pano, então o lote
 * grande demais estoura o tempo da requisição em vez de ir mais rápido.
 */
const LOTE = 50;

/**
 * Por quanto tempo a resposta vale.
 *
 * Número não costuma deixar de existir, mas passa a existir: quem instalou o
 * WhatsApp semana passada estava fora e agora está. Reconferir de mês em mês
 * devolve essas pessoas à base sem transformar toda campanha numa varredura.
 */
const VALIDADE_DIAS = 30;

export interface Conferencia {
  conferidos: number;
  semWhatsapp: number;
  /** Nulo quando deu tudo certo; a explicação quando não deu para conferir. */
  erro: string | null;
}

/**
 * Confere os números de uma empresa que ainda não foram conferidos, ou cuja
 * conferência envelheceu, e tira da lista quem não existe.
 *
 * `p_wa_ids` limita o trabalho ao recorte que importa agora — os
 * destinatários desta campanha — em vez da base inteira.
 */
export async function conferirNumeros(entrada: {
  companyId: string;
  channelId: string;
  waIds: string[];
}): Promise<Conferencia> {
  const db = supabaseAdmin();
  const vazio: Conferencia = { conferidos: 0, semWhatsapp: 0, erro: null };

  if (entrada.waIds.length === 0) return vazio;

  const desde = new Date(Date.now() - VALIDADE_DIAS * 86_400_000).toISOString();

  // Quem já foi conferido há pouco fica de fora: a segunda campanha para a
  // mesma lista não repete a pergunta inteira.
  const { data: pendentes } = await db
    .from("audience")
    .select("wa_id")
    .eq("company_id", entrada.companyId)
    .eq("is_sendable", true)
    .in("wa_id", entrada.waIds)
    .or(`whatsapp_em.is.null,whatsapp_em.lt.${desde}`);

  const numeros = (pendentes ?? []).map((l) => l.wa_id as string);
  if (numeros.length === 0) return vazio;

  let conexao;
  let instancia: string;
  try {
    const cred = await credenciaisDoCanal(entrada.channelId);
    if (cred.provider !== "evolution" || !cred.instanceName) {
      return { ...vazio, erro: "Só canais da Evolution conferem números." };
    }
    conexao = conexaoEvolution(cred);
    instancia = cred.instanceName;
  } catch (err) {
    return { ...vazio, erro: err instanceof Error ? err.message : String(err) };
  }

  const existem: string[] = [];
  const naoExistem: string[] = [];

  for (let i = 0; i < numeros.length; i += LOTE) {
    const lote = numeros.slice(i, i + LOTE);
    try {
      const resposta = await whatsappNumbers(conexao, instancia, lote);
      for (const linha of resposta) {
        (linha.exists ? existem : naoExistem).push(linha.number);
      }
    } catch (err) {
      // Um lote que falha não invalida os anteriores: o que já foi conferido
      // vale, e o resto fica para a próxima campanha.
      console.error("[conferência] lote não conferido", err);
      return {
        conferidos: existem.length,
        semWhatsapp: naoExistem.length,
        erro: err instanceof Error ? err.message : String(err),
      };
    }
  }

  await marcar(entrada.companyId, existem, naoExistem);

  return { conferidos: existem.length, semWhatsapp: naoExistem.length, erro: null };
}

/** Carimba quem existe e tira da lista quem não existe. */
async function marcar(companyId: string, existem: string[], naoExistem: string[]) {
  const db = supabaseAdmin();

  if (existem.length > 0) {
    await db
      .from("audience")
      .update({ whatsapp_em: new Date().toISOString() })
      .eq("company_id", companyId)
      .in("wa_id", existem);
  }

  // `opt_out` é o caminho de sempre: marca o contato e põe em `skipped` o que
  // já estava na fila para ele. Um por vez porque a função é por número — são
  // poucos, e é o preço de não duplicar a regra aqui.
  for (const wa of naoExistem) {
    const { error } = await db.rpc("opt_out", {
      p_company_id: companyId,
      p_wa_id: wa,
      p_reason: "no_whatsapp",
    });
    if (error) console.error(`[conferência] não consegui tirar ${wa} da lista`, error);
  }
}
