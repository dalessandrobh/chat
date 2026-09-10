/**
 * Regras da base de envio que a tela e a API precisam enxergar igual.
 *
 * Sem dependência de ambiente: é importado por Client Component e por rota.
 */

/** O que quem vai apagar a base inteira precisa digitar, letra por letra. */
export const FRASE_LIMPAR_BASE = "Quero limpar a base de contatos";

/**
 * Tolera caixa e espaço sobrando, nada além disso.
 *
 * A frase existe para obrigar a pessoa a parar e escrever uma sentença que
 * ninguém digita sem querer. Exigir também o Q maiúsculo transformaria isso
 * numa charada de teclado sem tornar o ato mais deliberado.
 */
export function fraseConfere(digitada: string): boolean {
  const limpa = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  return limpa(digitada) === limpa(FRASE_LIMPAR_BASE);
}

/** Por que o contato saiu da lista, em português. */
export const MOTIVO_FORA: Record<string, string> = {
  opt_out: "Não quer receber mensagens",
  no_whatsapp: "Sem WhatsApp",
  send_failed: "Falhou no envio",
  manual: "Retirado à mão",
};

/**
 * Quem pediu para sair é o único que exige uma segunda confirmação para
 * apagar. Os outros motivos são diagnóstico nosso — número errado, envio que
 * falhou — e apagar a linha só perde uma anotação. Este é uma vontade que a
 * pessoa expressou, e a linha é a prova de que ela expressou.
 */
export const EXIGE_CONFIRMACAO = "opt_out";

/**
 * O número em forma comparável: país + DDD + os oito dígitos finais.
 *
 * O 9 que a operadora acrescentou não é uma diferença de número — o WhatsApp
 * guarda o mesmo celular como 553598059605 e 5535998059605 conforme a época e
 * o aparelho, e comparar pelo texto cru deixa a mesma pessoa entrar duas vezes
 * e receber a mesma campanha duas vezes.
 *
 * Espelha `chat.chave_de_numero`, do 0033, que é quem manda: o banco compara
 * a base inteira por lá. Esta cópia serve para achar o repetido **dentro da
 * planilha que está sendo importada**, antes de ela chegar ao banco.
 */
export function chaveDeNumero(bruto: string): string {
  const d = (bruto ?? "").replace(/[^0-9]/g, "");
  if (/^55[0-9]{10,11}$/.test(d)) return d.slice(0, 4) + d.slice(-8);
  if (/^[0-9]{10,11}$/.test(d)) return "55" + d.slice(0, 2) + d.slice(-8);
  return d;
}
