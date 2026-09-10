/**
 * GET  /api/groups — os grupos da empresa, com quantos contatos cada um tem
 * POST /api/groups — cria um grupo
 *
 * Grupo é onde o contato está; etiqueta é o que ele tem. Por isso um contato
 * tem um grupo só, e a lista aqui é curta de propósito — se virar longa, o que
 * se queria eram etiquetas.
 *
 * Ler é de quem atende, porque a tela de campanha precisa dos grupos para
 * segmentar. Criar e mexer é de gestor, como o resto da base de envio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

const schema = z.object({
  nome: z.string().trim().min(1, "Dê um nome ao grupo").max(60),
});

function semPermissao() {
  return NextResponse.json({ error: "Sem permissão para mexer nos grupos." }, { status: 403 });
}

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();

  const [{ data: grupos, error }, { data: contatos }] = await Promise.all([
    supabase.from("contact_groups").select("id, nome").order("nome"),
    // A contagem vem em separado e é somada aqui: um `count` por grupo dentro
    // do select viraria uma consulta por linha, e a tela mostra os dois
    // números — quantos no grupo e quantos deles ainda recebem.
    supabase.from("audience").select("group_id, is_sendable").not("group_id", "is", null),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = new Map<string, { contatos: number; enviaveis: number }>();
  for (const c of contatos ?? []) {
    const chave = c.group_id as string;
    const atual = total.get(chave) ?? { contatos: 0, enviaveis: 0 };
    atual.contatos += 1;
    if (c.is_sendable) atual.enviaveis += 1;
    total.set(chave, atual);
  }

  return NextResponse.json({
    grupos: (grupos ?? []).map((g) => ({
      ...g,
      contatos: total.get(g.id)?.contatos ?? 0,
      enviaveis: total.get(g.id)?.enviaveis ?? 0,
    })),
  });
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return semPermissao();

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("contact_groups")
    .insert({ nome: parsed.data.nome, company_id: agent.company_id })
    .select("id, nome")
    .maybeSingle();

  if (error) {
    // 23505 é o índice que ignora caixa e espaço: "Revendedores" e
    // "revendedores " são o mesmo grupo digitado duas vezes.
    const texto =
      error.code === "23505" ? "Já existe um grupo com esse nome." : error.message;
    return NextResponse.json({ error: texto }, { status: 400 });
  }

  return NextResponse.json({ grupo: { ...data, contatos: 0, enviaveis: 0 } });
}
