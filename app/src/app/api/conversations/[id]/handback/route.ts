/**
 * POST /api/conversations/:id/handback
 * Devolve a conversa para a automação do n8n.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
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
  const { data, error } = await supabase.rpc("hand_back", {
    p_conversation_id: id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, conversation: data });
}
