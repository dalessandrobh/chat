/**
 * PATCH /api/campaigns/:id — pausa, retoma, cancela ou agenda
 *
 * Pausar é a alavanca que importa. Campanha grande sai por horas, e a hora em
 * que alguém percebe o erro de texto é sempre depois do primeiro envio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

const schema = z.object({
  status: z.enum(["scheduled", "running", "paused", "canceled"]).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.status) patch.status = parsed.data.status;
  if (parsed.data.scheduledAt !== undefined) patch.scheduled_at = parsed.data.scheduledAt;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .select("id, name, status, scheduled_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ campanha: data });
}
