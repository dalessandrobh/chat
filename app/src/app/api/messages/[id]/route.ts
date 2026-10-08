/**
 * PATCH  /api/messages/:id — edita o texto de uma mensagem enviada.
 * DELETE /api/messages/:id — apaga para todos.
 *
 * A mensagem é lida pela sessão de quem pediu: a RLS decide se ela existe para
 * essa pessoa, e o 404 serve também para quem não deveria saber dela. Depois
 * vale a mesma regra do envio — só o atendente que assumiu a conversa mexe.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { recusaSeNaoForDono } from "@/lib/dono-da-conversa";
import { editTextMessage, revokeMessage, type ChangeOutcome } from "@/lib/messages";

const editSchema = z.object({ text: z.string().trim().min(1).max(4096) });

const STATUS_BY_REASON = {
  not_found: 404,
  not_allowed: 409,
  expired: 409,
  disconnected: 409,
  provider_error: 502,
} as const;

/** Resolve a mensagem e confere o dono; devolve a resposta de recusa ou o id. */
async function autorizar(id: string) {
  const agent = await currentAgent();
  if (!agent) return { recusa: unauthorized() };

  const supabase = await supabaseServer();
  const { data: message } = await supabase
    .from("messages")
    .select("conversation_id")
    .eq("id", id)
    .maybeSingle();

  if (!message) {
    return { recusa: NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 }) };
  }

  const recusa = await recusaSeNaoForDono(supabase, message.conversation_id, agent.id);
  if (recusa) {
    const { status, ...corpo } = recusa;
    return { recusa: NextResponse.json(corpo, { status }) };
  }

  return { recusa: null };
}

function resposta(result: ChangeOutcome) {
  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    { error: result.message, reason: result.reason },
    { status: STATUS_BY_REASON[result.reason] }
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { recusa } = await autorizar(id);
  if (recusa) return recusa;

  return resposta(await editTextMessage({ messageId: id, text: parsed.data.text }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { recusa } = await autorizar(id);
  if (recusa) return recusa;

  return resposta(await revokeMessage({ messageId: id }));
}
