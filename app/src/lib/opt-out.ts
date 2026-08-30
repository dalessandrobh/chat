/**
 * Detecção de pedido para não receber mais mensagens.
 *
 * Deliberadamente generoso: errar para o lado de tirar alguém que queria ficar
 * custa uma mensagem a menos. Errar para o outro lado custa uma denúncia — e
 * denúncia é o que derruba o número.
 *
 * Só vale para mensagens curtas. "não quero mais receber essas promoções" é um
 * pedido; "não quero mais o modelo de 200L, prefiro o de 400" contém as mesmas
 * palavras e é o oposto de um pedido de saída.
 */

const PADROES: RegExp[] = [
  /\bsair\b/i,
  /\bpar[ae]r?\b.*\b(mensagens?|envios?|promo)/i,
  /\b(descadastr|desinscrev|remover?\s+da\s+lista|tirar?\s+da\s+lista)/i,
  /\bn[ãa]o\s+quero\s+(mais\s+)?(receber|mensagens?|promo)/i,
  /\bn[ãa]o\s+me\s+(mande|envie|manda|envia)/i,
  /\bme\s+(tira|remove|exclui|descadastra)/i,
  /\bcancelar?\s+(inscri|recebimento|mensagens?)/i,
  /^\s*(stop|sair|parar|cancelar)\s*[.!]?\s*$/i,
];

/** Acima disto, a frase provavelmente é sobre outra coisa. */
const LIMITE_CARACTERES = 160;

export function pediuParaSair(texto: string | null): boolean {
  if (!texto) return false;
  const t = texto.trim();
  if (!t || t.length > LIMITE_CARACTERES) return false;
  return PADROES.some((p) => p.test(t));
}

export const CONFIRMACAO_SAIDA =
  "Pronto, tirei você da nossa lista de mensagens. Você não vai mais receber " +
  "novidades nossas. Se precisar de alguma coisa, é só chamar por aqui.";
