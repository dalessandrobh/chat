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
