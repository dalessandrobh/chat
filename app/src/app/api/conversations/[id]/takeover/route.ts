/**
 * POST /api/conversations/:id/takeover
 * O agente assume a conversa. A partir daqui o bot não responde mais.
 *
 * Assumir é exclusivo: se outra pessoa já está atendendo, a rota recusa com
 * 409 e o nome de quem está lá. Tomar mesmo assim é possível, mas exige um
 * motivo — que fica gravado em chat.handoff_events junto com de quem foi.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { sendTextMessage } from "@/lib/messages";
import { mensagemAssumiu, mensagemTrocouDeAtendente } from "@/lib/handoff-messages";

const bodySchema = z
  .object({
    reason: z.string().max(500).optional(),
    /** Minutos até a devolução automática ao bot. Omitir = fica com o humano. */
    resumeAfterMinutes: z.number().int().min(1).max(10080).optional(),
    /** Tomar a conversa de outro atendente. */
    force: z.boolean().default(false),
  })
  // Tomar a conversa de alguém sem dizer por quê deixaria a auditoria com o
  // registro do que aconteceu e nenhum registro do motivo — que é justamente
  // o que alguém vai querer saber depois.
  .refine((b) => !b.force || (b.reason?.trim().length ?? 0) >= 3, {
    message: "Diga o motivo para assumir uma conversa de outro atendente",
    path: ["reason"],
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = await supabaseServer();

  // Dono anterior, lido antes da troca: é o que diz se houve troca de verdade.
  const { data: antes } = await supabase
    .from("conversations")
    .select("assigned_agent_id")
    .eq("id", id)
    .maybeSingle();

  // Qual das duas apresentações o cliente recebe não depende de quem era o
  // dono agora, e sim de o cliente já ter falado com alguém nesta conversa.
  // Uma conversa liberada de volta para a fila fica sem dono sem ter voltado
  // ao começo: dizer "agora você está sendo atendido por um ser humano" a quem
  // já estava com um soaria como se tudo tivesse recomeçado do zero.
  const { count: falasHumanas } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", id)
    .eq("author", "agent");

  // A RPC roda como security definer e usa auth.uid() para saber quem assumiu,
  // além de gravar o evento de auditoria em chat.handoff_events.
  const { data, error } = await supabase.rpc("take_over", {
    p_conversation_id: id,
    p_reason: parsed.data.reason ?? null,
    p_resume_after: parsed.data.resumeAfterMinutes
      ? `${parsed.data.resumeAfterMinutes} minutes`
      : null,
    p_force: parsed.data.force,
  });

  if (error) {
    // PT409 é a recusa por já ter dono. Não é erro de quem chamou: é conflito,
    // e a tela precisa distinguir para oferecer "assumir mesmo assim".
    const status = error.code === "PT409" ? 409 : 400;
    return NextResponse.json({ error: error.message, conflict: status === 409 }, { status });
  }

  // Só cala quando quem assumiu já era o dono — aí nada mudou para o cliente.
  if (antes && antes.assigned_agent_id !== agent.id) {
    await avisarCliente(id, agent.id, (falasHumanas ?? 0) > 0);
  }

  return NextResponse.json({ ok: true, conversation: data });
}

/**
 * Apresenta o atendente ao cliente.
 *
 * Falhar aqui não desfaz a assunção: a conversa já é do humano, e devolver
 * erro faria o painel mostrar fracasso para algo que deu certo. O agente vê
 * a mensagem faltando na thread, que é sinal suficiente.
 */
async function avisarCliente(
  conversationId: string,
  agentId: string,
  trocaDeAtendente: boolean
) {
  const { data: perfil } = await supabaseAdmin()
    .from("agents")
    .select("full_name")
    .eq("id", agentId)
    .maybeSingle();

  const nome = perfil?.full_name ?? null;

  const resultado = await sendTextMessage({
    conversationId,
    text: trocaDeAtendente ? mensagemTrocouDeAtendente(nome) : mensagemAssumiu(nome),
    author: "agent",
    agentId,
  });

  if (!resultado.ok) {
    console.error(`[takeover] aviso não enviado: ${resultado.message}`);
  }
}
