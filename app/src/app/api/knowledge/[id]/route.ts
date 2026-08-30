/**
 * PATCH  /api/knowledge/:id — edita, reordena ou liga/desliga uma seção
 * DELETE /api/knowledge/:id — remove
 *
 * Toda alteração aqui muda o que o agente vai dizer na próxima mensagem, sem
 * deploy e sem reinício. É esse o mecanismo de "treinar" o atendimento.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  position: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) {
    return NextResponse.json({ error: "Sem permissão para editar a base." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { title, content, position, isActive } = parsed.data;
  const patch: Record<string, unknown> = { updated_by: agent.id };
  if (title !== undefined) patch.title = title;
  if (content !== undefined) patch.content = content;
  if (position !== undefined) patch.position = position;
  if (isActive !== undefined) patch.is_active = isActive;

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("knowledge")
    .update(patch)
    .eq("id", id)
    .select("id, title, content, position, is_active, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ section: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) {
    return NextResponse.json({ error: "Sem permissão para editar a base." }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await supabaseServer();
  const { error } = await supabase.from("knowledge").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
