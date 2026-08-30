/**
 * GET  /api/audience — a base de envio
 * POST /api/audience — cadastra um contato, ou importa vários de uma vez
 *
 * Ninguém é apagado por aqui. Falha e opt-out marcam `is_sendable = false` e a
 * linha fica: é o que impede recadastrar amanhã o número que pediu para sair
 * hoje.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

const contatoSchema = z.object({
  name: z.string().trim().min(1).max(200),
  waId: z.string().trim().regex(/^[1-9][0-9]{7,14}$/, "Número em E.164 sem símbolos, ex.: 5531999998888"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

const postSchema = z.union([
  contatoSchema,
  z.object({ contatos: z.array(contatoSchema).min(1).max(5000) }),
]);

function forbidden() {
  return NextResponse.json({ error: "Sem permissão para editar a base de envio." }, { status: 403 });
}

export async function GET(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const busca = new URL(request.url).searchParams.get("q")?.trim();
  const supabase = await supabaseServer();

  let query = supabase
    .from("audience")
    .select("id, name, wa_id, tags, is_sendable, unsendable_reason, unsendable_at, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (busca) query = query.or(`name.ilike.%${busca}%,wa_id.ilike.%${busca}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contatos = data ?? [];
  return NextResponse.json({
    contatos,
    resumo: {
      total: contatos.length,
      enviaveis: contatos.filter((c) => c.is_sendable).length,
      fora: contatos.filter((c) => !c.is_sendable).length,
    },
  });
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return forbidden();

  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const lista = "contatos" in parsed.data ? parsed.data.contatos : [parsed.data];

  // `ignoreDuplicates` em vez de sobrescrever: reimportar a planilha inteira
  // não pode ressuscitar quem pediu para sair na semana passada.
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("audience")
    .upsert(
      lista.map((c) => ({ name: c.name, wa_id: c.waId, tags: c.tags ?? [] })),
      { onConflict: "wa_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const inseridos = data?.length ?? 0;
  return NextResponse.json({
    inseridos,
    ignorados: lista.length - inseridos,
  });
}
