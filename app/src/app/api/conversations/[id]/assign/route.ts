/**
 * POST /api/conversations/:id/assign
 * Direciona a conversa a um atendente. `agentId: null` tira o direcionamento.
 *
 * Direcionar não é entregar. A conversa continua na fila, contando o tempo de
 * espera e visível para todos — o que muda é o recado de que ela é para
 * alguém. Se fosse posse, direcionar a quem foi almoçar tiraria o cliente da
 * fila, do contador e do prazo, em silêncio.
 *
 * Por isso nada é enviado ao cliente: para ele não mudou nada, ele continua
 * esperando uma pessoa. Quem se apresenta é quem assume.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

const bodySchema = z
  .object({
    agentId: z.string().uuid().nullable(),
    reason: z.string().max(500).optional(),
    /** Direcionar uma conversa que está com outro atendente. */
    force: z.boolean().default(false),
  })
  .refine((b) => !b.force || (b.reason?.trim().length ?? 0) >= 3, {
    message: "Diga o motivo para direcionar a conversa de outro atendente",
    path: ["reason"],
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("atribuir_conversa", {
    p_conversation_id: id,
    p_agent_id: parsed.data.agentId,
    p_reason: parsed.data.reason ?? null,
    p_force: parsed.data.force,
  });

  if (error) {
    const status = error.code === "PT409" ? 409 : 400;
    return NextResponse.json({ error: error.message, conflict: status === 409 }, { status });
  }

  return NextResponse.json({ ok: true, conversation: data });
}
