/**
 * POST /api/conversations/:id/takeover
 * O agente assume a conversa. A partir daqui o bot não responde mais.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { sendTextMessage } from "@/lib/messages";
import { mensagemAssumiu } from "@/lib/handoff-messages";

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
  /** Minutos até a devolução automática ao bot. Omitir = fica com o humano. */
  resumeAfterMinutes: z.number().int().min(1).max(10080).optional(),
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

  // Modo anterior, lido antes da troca: é o que diz se houve troca de verdade.
  // Reassumir uma conversa que já está com humano não deve reapresentar o
  // atendente ao cliente.
  const { data: antes } = await supabase
    .from("conversations")
    .select("mode")
    .eq("id", id)
    .maybeSingle();

  // A RPC roda como security definer e usa auth.uid() para saber quem assumiu,
  // além de gravar o evento de auditoria em chat.handoff_events.
  const { data, error } = await supabase.rpc("take_over", {
    p_conversation_id: id,
    p_reason: parsed.data.reason ?? null,
    p_resume_after: parsed.data.resumeAfterMinutes
      ? `${parsed.data.resumeAfterMinutes} minutes`
      : null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (antes?.mode === "bot") {
    await avisarCliente(id, agent.id);
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
async function avisarCliente(conversationId: string, agentId: string) {
  const { data: perfil } = await supabaseAdmin()
    .from("agents")
    .select("full_name")
    .eq("id", agentId)
    .maybeSingle();

  const resultado = await sendTextMessage({
    conversationId,
    text: mensagemAssumiu(perfil?.full_name ?? null),
    author: "agent",
    agentId,
  });

  if (!resultado.ok) {
    console.error(`[takeover] aviso não enviado: ${resultado.message}`);
  }
}
