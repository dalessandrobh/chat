/**
 * GET  /api/knowledge — seções da base
 * POST /api/knowledge — cria uma seção
 *
 * A base inteira vai no prompt a cada mensagem, então tamanho aqui é custo
 * recorrente, não espaço em disco. Por isso a listagem devolve também o total
 * de caracteres: é o número que a tela usa para avisar antes de virar conta.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";

const createSchema = z.object({
  title: z.string().trim().min(1, "Dê um título à seção").max(120),
  content: z.string().trim().min(1, "A seção está vazia").max(20000),
  position: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

function forbidden() {
  return NextResponse.json(
    { error: "Só gestores e administradores editam a base." },
    { status: 403 }
  );
}

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("knowledge")
    .select("id, title, content, position, is_active, updated_at")
    .order("position")
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sections = data ?? [];

  // O texto vem da mesma função que o agente usa. Se a tela montasse o seu
  // próprio, um dia os dois divergiriam e ninguém perceberia.
  const { data: rendered } = await supabase.rpc("render_knowledge", {
    p_company_id: agent.company_id,
  });

  return NextResponse.json({
    sections,
    rendered: (rendered as string | null) ?? "",
    /** Só o que está ligado conta: é o que chega ao agente. */
    chars: sections
      .filter((s) => s.is_active)
      .reduce((total, s) => total + s.title.length + s.content.length + 4, 0),
  });
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("knowledge")
    .insert({
      title: parsed.data.title,
      content: parsed.data.content,
      position: parsed.data.position ?? 100,
      // Nasce desligada: ligar é dizer "conferi, pode falar isso".
      is_active: parsed.data.isActive ?? false,
      updated_by: agent.id,
      company_id: agent.company_id,
    })
    .select("id, title, content, position, is_active, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ section: data });
}
