/**
 * O vocabulário do horário de atendimento, compartilhado entre a tela e a API.
 *
 * Fica fora de `lib/horario.ts` de propósito: aquele fala com o banco e é
 * `server-only`, e o formulário precisa dos mesmos rótulos e do mesmo formato
 * sem arrastar a chave de serviço para o navegador.
 *
 * O dia é o número que o Postgres e o JavaScript usam: 0 é domingo. Dia
 * ausente do objeto é dia fechado, e objeto vazio quer dizer 24 horas — o que
 * mantém quem nunca abriu esta tela funcionando como sempre funcionou.
 */

export type Faixa = { abre: string; fecha: string };
export type HorarioSemana = Record<string, Faixa>;

/** Segunda primeiro, como o formulário e o prompt mostram. */
export const DIAS: { d: string; rotulo: string }[] = [
  { d: "1", rotulo: "Segunda" },
  { d: "2", rotulo: "Terça" },
  { d: "3", rotulo: "Quarta" },
  { d: "4", rotulo: "Quinta" },
  { d: "5", rotulo: "Sexta" },
  { d: "6", rotulo: "Sábado" },
  { d: "0", rotulo: "Domingo" },
];

/** Os fusos do Brasil. Errar o fuso é decidir "fechado" na hora errada. */
export const FUSOS: { valor: string; rotulo: string }[] = [
  { valor: "America/Sao_Paulo", rotulo: "Brasília (SP, RJ, MG, Sul, Nordeste)" },
  { valor: "America/Cuiaba", rotulo: "Mato Grosso e Mato Grosso do Sul" },
  { valor: "America/Manaus", rotulo: "Amazonas, Rondônia e Roraima" },
  { valor: "America/Rio_Branco", rotulo: "Acre" },
  { valor: "America/Noronha", rotulo: "Fernando de Noronha" },
];

export const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const PADRAO: Faixa = { abre: "08:00", fecha: "18:00" };
