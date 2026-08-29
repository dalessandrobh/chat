/**
 * POST /api/conversations/:id/takeover
 * O agente assume a conversa. A partir daqui o bot não responde mais.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

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

  return NextResponse.json({ ok: true, conversation: data });
}
