/**
 * A memória do contato, entre conversas.
 *
 * O agente já lembra da conversa aberta — o contexto manda as últimas
 * mensagens — e dos campos da qualificação, que ficam gravados no contato. O
 * que some é o resto: a pessoa volta em março, repete a história de janeiro, e
 * o atendimento recomeça do zero.
 *
 * Aqui mora o resto. Uma frase por linha, com data e origem, em
 * `chat.contact_memory`; a poda e o texto do prompt são do banco (ver 0036).
 *
 * O que este arquivo faz é a parte que não é do banco: decidir o que de fato
 * veio do modelo. Modelo manda campo vazio, manda "null", manda um parágrafo
 * inteiro no lugar de uma frase — e nada disso pode virar linha gravada.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Mesmo teto do `check` da tabela: frase, não parágrafo. */
export const LIMITE_FATO = 300;

/** Quantos fatos uma chamada pode gravar de uma vez. O modelo que "lembra" de
 *  dez coisas num turno está resumindo a conversa, não apurando nada. */
export const LIMITE_POR_CHAMADA = 5;

/** As formas de dizer "não sei" que o modelo manda como se fossem conteúdo. */
const NADA = /^\s*(|null|undefined|n\/a|nada|não informado|nao informado|-)\s*$/i;

/**
 * O que veio do modelo, virado em fatos graváveis.
 *
 * Aceita string, string com quebras de linha e lista: o modelo usa as três
 * formas, e recusar por causa da forma perderia o que ele acabou de apurar.
 * Marcador de lista no começo da linha sai fora — ele copia o formato que
 * recebeu no prompt.
 */
export function limparFatos(bruto: unknown): string[] {
  const linhas = Array.isArray(bruto)
    ? bruto.map((x) => String(x ?? ""))
    : String(bruto ?? "").split("\n");

  const limpos: string[] = [];
  const vistos = new Set<string>();

  for (const linha of linhas) {
    const fato = linha
      .replace(/^\s*[-*•]\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, LIMITE_FATO);

    if (fato.length < 3 || NADA.test(fato)) continue;

    // Duplicata dentro da mesma chamada: o banco também barra, mas errar aqui
    // gastaria uma ida ao banco para descobrir o que já se sabia.
    const chave = fato.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    limpos.push(fato);
    if (limpos.length >= LIMITE_POR_CHAMADA) break;
  }

  return limpos;
}

/**
 * Grava o que o agente apurou sobre a pessoa.
 *
 * Devolve só o que entrou de verdade. Repetido não é erro: o índice único da
 * tabela recusa em silêncio, e o agente que contou a mesma coisa duas vezes
 * não precisa saber disso.
 */
export async function gravarFatos(entrada: {
  contactId: string;
  companyId: string;
  conversationId: string;
  fatos: string[];
}): Promise<string[]> {
  if (entrada.fatos.length === 0) return [];

  // `chave` é coluna gerada: o conflito é resolvido por ela, mas quem escreve
  // é só `fato`.

  const { data, error } = await supabaseAdmin()
    .from("contact_memory")
    .upsert(
      entrada.fatos.map((fato) => ({
        company_id: entrada.companyId,
        contact_id: entrada.contactId,
        conversation_id: entrada.conversationId,
        fato,
        origem: "bot",
      })),
      { onConflict: "contact_id,chave", ignoreDuplicates: true }
    )
    .select("fato");

  if (error) {
    // Falhar aqui não pode derrubar a anotação da qualificação, que é o outro
    // trabalho da mesma rota: memória é ganho, qualificação é o combinado.
    console.error("[memória] não consegui gravar o que o agente apurou", error);
    return [];
  }

  return (data ?? []).map((l) => l.fato as string);
}

/**
 * A memória em markdown, do jeito que entra no prompt.
 *
 * Montada no banco: a tela de conferência lê a mesma função, e montar o texto
 * em dois lugares é combinar que um dia eles divirjam sem ninguém perceber.
 */
export async function memoriaDoContato(contactId: string): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc("render_contact_memory", {
    p_contact_id: contactId,
  });

  if (error) {
    console.error("[memória] não consegui montar a memória do contato", error);
    return "";
  }

  return (data as string | null) ?? "";
}
