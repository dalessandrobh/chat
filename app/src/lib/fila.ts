/**
 * A fila de atendimento, do ponto de vista de quem olha a tela.
 *
 * Esperar não é um campo: é o trio `mode = human`, sem dono, não encerrada. O
 * banco carimba `aguardando_desde` sempre que esse trio se forma, então aqui
 * basta olhar o carimbo — quem quiser saber a regra encontra o gatilho
 * `chat.marcar_espera`, e não uma segunda cópia dela em TypeScript.
 */

import type { InboxRow } from "@/lib/types";

export function estaAguardando(row: InboxRow): boolean {
  return row.aguardando_desde !== null;
}

/**
 * "Minhas" é o que estou atendendo mais o que foi direcionado a mim.
 *
 * O direcionamento não tira a conversa da fila — ela continua contando e
 * visível para todos —, mas precisa aparecer para quem recebeu o recado, senão
 * direcionar não serve para nada.
 */
export function ehMinha(row: InboxRow, agenteId: string | null): boolean {
  if (!agenteId || row.status === "closed") return false;
  return row.assigned_agent_id === agenteId || row.atribuida_para === agenteId;
}

/** "há 3min", "há 2h". Curto porque divide espaço com o nome do contato. */
export function esperaEmTexto(iso: string | null, agora = Date.now()): string {
  if (!iso) return "";
  const minutos = Math.floor((agora - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  return `há ${Math.floor(horas / 24)}d`;
}

/**
 * Ordena a fila do mais antigo para o mais novo.
 *
 * É o contrário da lista geral, e de propósito: na lista o que importa é o que
 * acabou de acontecer; na fila, quem está esperando há mais tempo.
 */
export function porEsperaMaisLonga(a: InboxRow, b: InboxRow): number {
  return (a.aguardando_desde ?? "").localeCompare(b.aguardando_desde ?? "");
}
