/**
 * Quando uma mensagem enviada ainda pode ser editada ou apagada.
 *
 * Os prazos são do próprio WhatsApp; passados eles a Evolution só devolveria
 * erro. A mesma régua vale no servidor, que decide, e no painel, que só
 * esconde o botão antes do clique.
 */

import type { Message } from "@/lib/types";

export const PRAZO_EDICAO_MS = 15 * 60 * 1000;
export const PRAZO_APAGAR_MS = 2 * 24 * 60 * 60 * 1000;

type Alteravel = Pick<
  Message,
  "direction" | "author" | "agent_id" | "status" | "wa_message_id" | "deleted_at" | "created_at" | "type"
>;

/**
 * Só vale o que o painel mandou (`agent_id` preenchido): o que saiu pelo
 * celular, ou pelo bot, não passa — por enquanto.
 */
function mandadaPeloPainel(m: Alteravel): boolean {
  return (
    m.direction === "out" &&
    m.author === "agent" &&
    !!m.agent_id &&
    !!m.wa_message_id &&
    !m.deleted_at &&
    (m.status === "sent" || m.status === "delivered" || m.status === "read")
  );
}

function dentroDoPrazo(m: Alteravel, prazoMs: number): boolean {
  return Date.now() - new Date(m.created_at).getTime() <= prazoMs;
}

export function podeEditar(m: Alteravel): boolean {
  return mandadaPeloPainel(m) && m.type === "text" && dentroDoPrazo(m, PRAZO_EDICAO_MS);
}

export function podeApagar(m: Alteravel): boolean {
  return mandadaPeloPainel(m) && dentroDoPrazo(m, PRAZO_APAGAR_MS);
}
