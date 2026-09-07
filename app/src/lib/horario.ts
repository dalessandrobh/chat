/**
 * O expediente da equipe humana.
 *
 * O bot atende 24 horas; a equipe, não. Quando a conversa vai para a fila às
 * onze da noite, dizer "já vou chamar alguém" e parar por aí é uma promessa
 * que só vai ser cumprida daqui a nove horas — e ninguém avisou.
 *
 * Quem decide se está aberto é o banco, no fuso da empresa: só ele tem o
 * horário cadastrado, e o modelo de linguagem nem sabe que horas são. Aqui só
 * sobra transformar o instante em frase — "hoje", "amanhã", "segunda-feira".
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type HorarioAgora = {
  aberta: boolean;
  /** Falso quando a empresa não cadastrou horário nenhum — ou seja, 24 horas. */
  configurado: boolean;
  /** Próxima abertura em ISO, ou nulo se a empresa nunca fecha. */
  proxima: string | null;
  fuso: string;
};

const SEMPRE_ABERTA: HorarioAgora = {
  aberta: true,
  configurado: false,
  proxima: null,
  fuso: "America/Sao_Paulo",
};

export async function horarioAgora(companyId: string): Promise<HorarioAgora> {
  const { data, error } = await supabaseAdmin().rpc("horario_de_atendimento", {
    p_company_id: companyId,
  });

  // Falhar aqui não pode calar o aviso de escalada inteiro. Sem resposta do
  // banco, tratamos como empresa sem horário: o cliente recebe a mensagem do
  // bot sem o complemento, que é exatamente o comportamento de antes.
  if (error || !data) {
    if (error) console.error("[horário] não consegui ler o expediente", error);
    return SEMPRE_ABERTA;
  }

  return data as HorarioAgora;
}

/**
 * O complemento que entra na última mensagem antes de a conversa virar humana.
 *
 * Nulo quando a empresa está aberta ou não cadastrou horário: nesses casos não
 * há nada a explicar, e uma frase a mais só atrasaria a leitura.
 */
export function avisoForaDoHorario(h: HorarioAgora, agora = new Date()): string | null {
  if (h.aberta || !h.configurado) return null;

  const quando = h.proxima ? quandoAbre(new Date(h.proxima), agora, h.fuso) : null;

  return quando
    ? `Agora estamos fora do horário de atendimento, mas já deixei sua conversa na fila: um atendente entra em contato ${quando}.`
    : "Agora estamos fora do horário de atendimento, mas já deixei sua conversa na fila: um atendente entra em contato assim que o expediente começar.";
}

/** "hoje às 08:00", "amanhã às 08:00", "na segunda-feira às 08:00". */
function quandoAbre(proxima: Date, agora: Date, fuso: string): string | null {
  try {
    const hora = formatar(proxima, fuso, { hour: "2-digit", minute: "2-digit", hour12: false });
    const dias = distanciaEmDias(agora, proxima, fuso);

    if (dias <= 0) return `hoje às ${hora}`;
    if (dias === 1) return `amanhã às ${hora}`;
    if (dias < 7) {
      const semana = formatar(proxima, fuso, { weekday: "long" });
      return `na ${semana} às ${hora}`;
    }

    const data = formatar(proxima, fuso, { day: "2-digit", month: "2-digit" });
    return `dia ${data} às ${hora}`;
  } catch (err) {
    // Fuso inválido no cadastro derrubaria o Intl. Sem a frase o cliente ainda
    // recebe o aviso genérico, que é melhor que uma escalada sem mensagem.
    console.error(`[horário] não consegui formatar a próxima abertura (${fuso})`, err);
    return null;
  }
}

function formatar(d: Date, fuso: string, opcoes: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...opcoes }).format(d);
}

/**
 * Diferença em dias de calendário, não em horas: das 23h às 8h são nove horas,
 * mas é "amanhã". Comparar as datas no fuso da empresa é o que dá essa conta.
 */
function distanciaEmDias(de: Date, ate: Date, fuso: string): number {
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const a = Date.parse(`${dia(de)}T00:00:00Z`);
  const b = Date.parse(`${dia(ate)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
