/**
 * PATCH /api/channels/:id — renomeia ou pausa o canal
 *
 * Pausar cala o que sai sozinho: o bot não responde e as campanhas não
 * disparam por este número. A conversa continua chegando e aparecendo no
 * painel, e quem estiver lá responde na mão — pausar é tirar o robô do ar,
 * não o cliente.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageChannels } from "@/lib/roles";

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: "Nada para alterar",
  });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  if (!canManageChannels(agent.role)) {
    return NextResponse.json({ error: "Só administradores mexem em canais." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;

  const { data, error } = await supabaseAdmin()
    .from("channels")
    .update(patch)
    .eq("id", id)
    .select("id, name, provider, instance_name, display_phone_number, connection_state, connected_at, is_active")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Canal não encontrado" }, { status: 404 });

  return NextResponse.json({ channel: data });
}
