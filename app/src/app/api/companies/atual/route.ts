/**
 * GET   /api/companies/atual — a empresa de quem está logado
 * PATCH /api/companies/atual — renomeia
 *
 * Sempre a própria: não existe parâmetro de empresa. Aceitar um id aqui seria
 * abrir a porta que a regra de acesso passou sete migrações fechando.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageUsers } from "@/lib/roles";

const patchSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome à empresa").max(80),
});

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();

  // Sem filtro por id: a regra de acesso só deixa a própria aparecer.
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, slug, is_active, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  const [{ count: equipe }, { count: canais }] = await Promise.all([
    supabase.from("agents").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("channels").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    empresa: data,
    equipe: equipe ?? 0,
    canais: canais ?? 0,
    podeRenomear: canManageUsers(agent.role),
  });
}

export async function PATCH(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  // Mesma régua de quem mexe em usuários: o nome da empresa é o que o cliente
  // ouve na despedida do bot, não é enfeite de tela.
  if (!canManageUsers(agent.role)) {
    return NextResponse.json(
      { error: "Só administradores renomeiam a empresa." },
      { status: 403 }
    );
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("companies")
    .update({ name: parsed.data.name })
    .eq("id", agent.company_id)
    .select("id, name, slug, is_active, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Nada foi alterado" }, { status: 403 });

  return NextResponse.json({ empresa: data });
}
