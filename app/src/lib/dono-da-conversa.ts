/**
 * Quem pode mexer numa conversa: só o atendente que a assumiu.
 *
 * Vale para mandar, editar e apagar. Sem isto, dois atendentes respondem o
 * mesmo cliente ao mesmo tempo e nada no caminho reclama — o cliente é que
 * descobre, com duas respostas diferentes para a mesma pergunta.
 *
 * A leitura é pela sessão da pessoa, então a RLS já garante que a conversa é
 * da empresa dela: não achar aqui é "não existe para você".
 */

import type { supabaseServer } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;

export interface RecusaDeConversa {
  status: number;
  error: string;
  conflict?: true;
}

/**
 * Por que a ação foi recusada, na linguagem de quem está olhando a tela.
 *
 * São três situações diferentes com o mesmo desfecho, e dizer só "sem
 * permissão" faria o atendente procurar o problema no lugar errado.
 */
function recusa(mode: string, donoId: string | null, donoNome: string | null): string {
  if (mode === "bot") {
    return "A automação está respondendo esta conversa. Assuma para responder.";
  }
  if (!donoId) {
    return "Ninguém assumiu esta conversa ainda. Assuma para responder.";
  }
  return `${donoNome?.trim() || "Outro atendente"} está atendendo esta conversa.`;
}

/** `null` quando `agentId` é o dono; senão, a recusa pronta para devolver. */
export async function recusaSeNaoForDono(
  supabase: Supabase,
  conversationId: string,
  agentId: string
): Promise<RecusaDeConversa | null> {
  const { data: conversa } = await supabase
    .from("conversations")
    .select("mode, assigned_agent_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversa) return { status: 404, error: "Conversa não encontrada" };

  if (conversa.assigned_agent_id === agentId) return null;

  // O nome só é buscado quando a resposta vai ser recusada. No caminho que
  // dá certo, que é o normal, esta consulta não acontece.
  const { data: dono } = conversa.assigned_agent_id
    ? await supabase
        .from("agents")
        .select("full_name")
        .eq("id", conversa.assigned_agent_id)
        .maybeSingle()
    : { data: null };

  return {
    status: 409,
    error: recusa(conversa.mode, conversa.assigned_agent_id, dono?.full_name ?? null),
    conflict: true,
  };
}
