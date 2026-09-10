/**
 * PATCH  /api/groups/:id — renomeia
 * DELETE /api/groups/:id — apaga o grupo, não os contatos
 *
 * Apagar devolve os contatos para "sem grupo" — é o que a chave estrangeira
 * faz, e é a diferença entre desfazer uma organização e perder a base. A tela
 * diz quantos contatos vão ficar sem grupo antes de perguntar.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

// Repetida em vez de importada do `route.ts` vizinho: arquivo de rota só pode
// exportar handler e configuração, e um export a mais quebra o build.
function semPermissao() {
  return NextResponse.json({ error: "Sem permissão para mexer nos grupos." }, { status: 403 });
}

const schema = z.object({
  nome: z.string().trim().min(1, "Dê um nome ao grupo").max(60),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return semPermissao();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { id } = await params;
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("contact_groups")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .select("id, nome")
    .maybeSingle();

  if (error) {
    const texto =
      error.code === "23505" ? "Já existe um grupo com esse nome." : error.message;
    return NextResponse.json({ error: texto }, { status: 400 });
  }
  if (!data) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });

  return NextResponse.json({ grupo: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return semPermissao();

  const { id } = await params;
  const supabase = await supabaseServer();

  const { count } = await supabase
    .from("audience")
    .select("id", { count: "exact", head: true })
    .eq("group_id", id);

  const { error } = await supabase.from("contact_groups").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, semGrupoAgora: count ?? 0 });
}
