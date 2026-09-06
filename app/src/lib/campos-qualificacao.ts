/**
 * Validação da fila de perguntas, compartilhada pelas duas rotas do painel.
 *
 * Fica fora dos `route.ts` porque o Next só admite os verbos HTTP como export
 * de uma rota — e porque criar e editar precisam concordar sobre o que é uma
 * chave válida.
 */

import { z } from "zod";
import { CHAVES_RESERVADAS } from "@/lib/qualificacao";

export const COLUNAS =
  "id, chave, pergunta, tipo, position, is_active, depende_de, depende_valor, updated_at";

/**
 * A chave é o nome do dado dentro do metadata do contato, então ela é um slug
 * e não uma frase — e não pode ser uma das três que o próprio objeto usa para
 * se controlar. O banco repete as duas regras: esta camada dá a mensagem em
 * português, aquela garante que nenhum outro caminho escape.
 */
export const chaveSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, "A chave usa letras minúsculas, números e _, começando por letra")
  .refine(
    (c) => !(CHAVES_RESERVADAS as readonly string[]).includes(c),
    "Essa chave é reservada pelo próprio cadastro"
  );

/** Dependência é par: sem os dois lados ela não existe, e meia dependência
 *  faria a pergunta sumir da fila para sempre. */
export function normalizarDependencia(de?: string | null, valor?: string | null) {
  const d = (de ?? "").trim();
  const v = (valor ?? "").trim();
  if (!d || !v) return { depende_de: null, depende_valor: null };
  return { depende_de: d, depende_valor: v };
}

/** Expressão regular quebrada só apareceria na hora de montar a fila, e
 *  silenciosamente — a pergunta dependente nunca mais entraria. */
export function regexInvalida(valor: string | null): string | null {
  if (!valor) return null;
  try {
    new RegExp(valor, "i");
    return null;
  } catch {
    return "A condição não é uma expressão válida";
  }
}
