/**
 * POST /api/conversations/:id/release
 * O atendente solta a conversa de volta para a fila.
 *
 * Não é o mesmo que devolver ao bot. O cliente pediu uma pessoa e continua
 * querendo uma: a conversa volta para `pending`, sem dono, e nada é enviado a
 * ele — anunciar um rodízio interno seria ruído, não aviso.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

const bodySchema = z
  .object({
    reason: z.string().max(500).optional(),
    /** Tirar da fila a conversa que está com outro atendente. */
    force: z.boolean().default(false),
  })
  .refine((b) => !b.force || (b.reason?.trim().length ?? 0) >= 3, {
    message: "Diga o motivo para liberar a conversa de outro atendente",
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
  const { data, error } = await supabase.rpc("liberar_para_fila", {
    p_conversation_id: id,
    p_reason: parsed.data.reason ?? null,
    p_force: parsed.data.force,
  });

  if (error) {
    const status = error.code === "PT409" ? 409 : 400;
    return NextResponse.json({ error: error.message, conflict: status === 409 }, { status });
  }

  return NextResponse.json({ ok: true, conversation: data });
}
