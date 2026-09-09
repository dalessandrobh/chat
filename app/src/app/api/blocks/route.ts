/**
 * GET    /api/blocks — números bloqueados da empresa
 * POST   /api/blocks — bloqueia um número
 * DELETE /api/blocks?waId=… — desbloqueia
 *
 * Sem trava de papel: bloquear é ferramenta de quem atende, e quem está com a
 * conversa aberta às onze da noite é um atendente. A RLS confere o resto —
 * agente ativo, e só da própria empresa.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

const postSchema = z.object({
  waId: z.string().min(8).max(20),
  reason: z.string().max(200).optional(),
});

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("blocked_numbers")
    .select("id, wa_id, chave, reason, created_at, agente:agents(full_name)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ bloqueios: data ?? [] });
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Número inválido" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("bloquear_numero", {
    p_wa_id: parsed.data.waId,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, bloqueio: data });
}

export async function DELETE(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const waId = new URL(request.url).searchParams.get("waId");
  if (!waId) return NextResponse.json({ error: "Número não informado" }, { status: 400 });

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("desbloquear_numero", { p_wa_id: waId });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
