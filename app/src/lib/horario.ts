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
 *
 * E sobra uma decisão que não é de texto: fora do expediente, a conversa que
 * está na fila sem dono continua sendo atendida pelo bot. Prometer a manhã e
 * calar na pergunta seguinte era prometer duas coisas contrárias.
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
 * O trecho pelo qual o aviso se reconhece numa conversa já escrita.
 *
 * Existe porque o aviso não pode ser dado duas vezes na mesma espera: a
 * conversa que escalou às 22h e às 22h10 manda um áudio ilegível passaria de
 * novo pela escalada, e repetir "estamos fora do horário" a quem acabou de
 * ouvir isso é ruído. Comparar pelo texto é frágil, sim — mas o falso
 * positivo aqui é o bot ter mesmo dito a frase, que é o que se queria saber.
 */
export const MARCA_DO_AVISO = "fora do horário de atendimento";
const MARCA_DO_AVISO_MAIUSCULA = `Agora estamos ${MARCA_DO_AVISO}`;

/**
 * O complemento que entra na última mensagem antes de a conversa virar humana.
 *
 * Nulo quando a empresa está aberta ou não cadastrou horário: nesses casos não
 * há nada a explicar, e uma frase a mais só atrasaria a leitura.
 */
export function avisoForaDoHorario(h: HorarioAgora, agora = new Date()): string | null {
  if (h.aberta || !h.configurado) return null;

  const quando = h.proxima ? quandoAbre(new Date(h.proxima), agora, h.fuso) : null;

  const volta = quando
    ? `um atendente entra em contato ${quando}`
    : "um atendente entra em contato assim que o expediente começar";

  // "Sigo por aqui" não é gentileza de fechamento: fora do expediente a
  // conversa na fila continua sendo atendida pelo bot (ver 0035), então a
  // frase descreve o que vai acontecer de fato na próxima pergunta.
  return `${MARCA_DO_AVISO_MAIUSCULA}, mas já deixei sua conversa na fila: ${volta}. Enquanto isso sigo por aqui — se der para ajudar em alguma coisa, é só dizer.`;
}

/**
 * "hoje a partir das 08:00", "amanhã a partir das 08:00", "no sábado a partir
 * das 08:00".
 *
 * "a partir das", e não "às": o que o banco sabe é quando a empresa abre, não
 * quando alguém vai pegar esta conversa. Marcar a hora exata seria prometer em
 * nome de uma pessoa que ainda vai chegar — a mesma promessa que o prompt
 * proíbe o modelo de fazer.
 */
function quandoAbre(proxima: Date, agora: Date, fuso: string): string | null {
  try {
    const hora = formatar(proxima, fuso, { hour: "2-digit", minute: "2-digit", hour12: false });
    const dias = distanciaEmDias(agora, proxima, fuso);

    if (dias <= 0) return `hoje a partir das ${hora}`;
    if (dias === 1) return `amanhã a partir das ${hora}`;
    if (dias < 7) {
      const semana = formatar(proxima, fuso, { weekday: "long" });
      // Cinco dias da semana são "-feira", e femininos; sábado e domingo são
      // masculinos. Sem isto sai "na sábado".
      const artigo = semana.endsWith("-feira") ? "na" : "no";
      return `${artigo} ${semana} a partir das ${hora}`;
    }

    const data = formatar(proxima, fuso, { day: "2-digit", month: "2-digit" });
    return `dia ${data} a partir das ${hora}`;
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

/**
 * A conversa está esperando na fila com a empresa fechada?
 *
 * É o estado em que o bot continua atendendo mesmo tendo escalado: humano,
 * sem dono, não arquivada, e a equipe só volta no próximo expediente. Quem
 * decide é o banco (`0035`), que é quem sabe a grade e o fuso.
 *
 * Falha do banco responde "não", e o efeito é o comportamento de antes: o bot
 * cala e a conversa espera a equipe. Errar para o lado de falar seria arriscar
 * responder por cima de um atendente, que é a coisa que este projeto não faz.
 */
export async function filaForaDoExpediente(conversationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("fila_fora_do_expediente", {
    p_conversation_id: conversationId,
  });

  if (error) {
    console.error("[horário] não consegui ver se a fila está fora do expediente", error);
    return false;
  }

  return data === true;
}

/**
 * O aviso de fora do horário já foi dado nesta espera?
 *
 * A janela é `aguardando_desde`, e não um intervalo de minutos: a espera é
 * exatamente o período em que o aviso continua valendo. Saiu da fila e voltou,
 * é outra espera, e o aviso é dado de novo — porque a hora mudou.
 */
export async function avisoJaDado(conversationId: string): Promise<boolean> {
  const db = supabaseAdmin();

  const { data: conversa } = await db
    .from("conversations")
    .select("aguardando_desde")
    .eq("id", conversationId)
    .maybeSingle();

  // Sem carimbo de espera não há espera para comparar, e o aviso vale.
  if (!conversa?.aguardando_desde) return false;

  const { data } = await db
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "out")
    .ilike("body", `%${MARCA_DO_AVISO}%`)
    .gte("created_at", conversa.aguardando_desde)
    .limit(1);

  return (data?.length ?? 0) > 0;
}
