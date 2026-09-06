/**
 * As diretrizes que o agente recebe de cada empresa.
 *
 * O prompt do n8n é um só para todas: nele moram as regras da plataforma —
 * não inventar, não afirmar o que não está na base, escalar em vez de chutar,
 * nunca terminar a rodada calado. Essas regras não são editáveis, e é de
 * propósito: quem escreve o próprio prompt apaga sem querer justamente as
 * linhas que fazem a ferramenta funcionar, e aí cada empresa vira uma variante
 * para depurar.
 *
 * O que varia por empresa entra por aqui, e chega ao agente pela mesma chamada
 * de contexto que já existia: o perfil (camada 2) e a fila de perguntas. A
 * base de conhecimento (camada 3) continua vindo do `render_knowledge`.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Campo } from "@/lib/qualificacao";

/**
 * A fila de perguntas da empresa, já na ordem.
 *
 * Erro de banco devolve fila vazia, e fila vazia significa "não pergunte
 * mais nada" — o agente conversa e escala. É o degrau certo para falhar:
 * perguntar de novo o que já foi respondido seria pior.
 */
export async function camposDaEmpresa(companyId: string): Promise<Campo[]> {
  const { data, error } = await supabaseAdmin()
    .from("qualification_fields")
    .select("chave, pergunta, tipo, depende_de, depende_valor")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("position")
    .order("created_at");

  if (error) {
    console.error("[diretrizes] não consegui ler a fila de qualificação", error);
    return [];
  }

  return (data ?? []).map((c) => ({
    chave: c.chave,
    pergunta: c.pergunta,
    tipo: c.tipo === "numero" ? "numero" : "texto",
    dependeDe: c.depende_de,
    dependeValor: c.depende_valor,
  }));
}

/**
 * O perfil da empresa em markdown, montado no banco.
 *
 * A tela de conferência chama a mesma função: montar o texto em dois lugares
 * é combinar que um dia eles divirjam sem ninguém perceber.
 */
export async function perfilDaEmpresa(companyId: string): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc("render_company_profile", {
    p_company_id: companyId,
  });

  if (error) {
    console.error("[diretrizes] não consegui montar o perfil da empresa", error);
    return "";
  }

  return (data as string | null) ?? "";
}
