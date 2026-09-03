/**
 * GET    /api/audience — a base de envio
 * POST   /api/audience — cadastra um contato, ou importa vários de uma vez
 * DELETE /api/audience — apaga a base inteira da empresa
 *
 * Nada é apagado sozinho por aqui. Falha e opt-out marcam `is_sendable = false`
 * e a linha fica: é o que impede recadastrar amanhã o número que pediu para
 * sair hoje. Apagar é sempre um pedido explícito de alguém — o contato de cada
 * vez fica em /api/audience/:id; aqui só a base toda, e só para quem digitar a
 * frase inteira.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";
import { fraseConfere, FRASE_LIMPAR_BASE } from "@/lib/base-envio";

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

  // A lista para na linha 500; o resumo, não. Contar em separado é o que faz
  // os cartões do topo — e o aviso de quantos opt-outs a limpeza vai levar
  // junto — dizerem a verdade numa base de dez mil.
  const contagem = () =>
    supabase.from("audience").select("id", { count: "exact", head: true });

  const [{ count: total }, { count: fora }, { count: pediramSair }] = await Promise.all([
    contagem(),
    contagem().eq("is_sendable", false),
    contagem().eq("unsendable_reason", "opt_out"),
  ]);

  return NextResponse.json({
    contatos: data ?? [],
    resumo: {
      total: total ?? 0,
      enviaveis: (total ?? 0) - (fora ?? 0),
      fora: fora ?? 0,
      pediramSair: pediramSair ?? 0,
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
      lista.map((c) => ({
        name: c.name,
        wa_id: c.waId,
        tags: c.tags ?? [],
        company_id: agent.company_id,
      })),
      { onConflict: "company_id,wa_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const inseridos = data?.length ?? 0;

  // No cadastro de um contato só, "ignorado" não é estatística: é a resposta.
  // Quem digitou o número precisa saber que ele já estava lá, e não ver um
  // "pronto" que não gravou nada.
  if (!("contatos" in parsed.data) && inseridos === 0) {
    return NextResponse.json(
      { error: "Esse número já está na base." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    inseridos,
    ignorados: lista.length - inseridos,
  });
}

/**
 * Apaga a base inteira da empresa.
 *
 * A frase por extenso é a única trava, e é de propósito: um `confirm()` do
 * navegador some com um Enter distraído, e esta é a operação que não tem
 * desfazer. Vai junto quem pediu para sair — e com ele a linha que impedia o
 * número de voltar na próxima planilha —, então a tela avisa quantos são
 * antes de aceitar a frase.
 */
export async function DELETE(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return forbidden();

  const corpo = await request.json().catch(() => ({}));
  const frase = typeof corpo?.frase === "string" ? corpo.frase : "";

  if (!fraseConfere(frase)) {
    return NextResponse.json(
      { error: `Para limpar a base, digite exatamente: ${FRASE_LIMPAR_BASE}` },
      { status: 400 }
    );
  }

  const supabase = await supabaseServer();
  const { count, error } = await supabase
    .from("audience")
    .delete({ count: "exact" })
    .eq("company_id", agent.company_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ apagados: count ?? 0 });
}
