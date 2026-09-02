/**
 * GET   /api/settings — ajustes de operação
 * PATCH /api/settings — muda um ajuste
 *
 * Chave e valor porque o que se ajusta aqui muda o custo de operar, não o
 * comportamento do código: quem paga a conta liga e desliga sem deploy.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";
import { AJUSTES } from "@/lib/ajustes";
import { serverEnv } from "@/lib/env";

const patchSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal(AJUSTES.lerImagens), value: z.boolean() }),
  // Zero é o desligado: prazo sem número não é prazo, e nulo obrigaria a tela
  // a distinguir "vazio" de "nunca mexeram".
  z.object({ key: z.literal(AJUSTES.devolverAoBot), value: z.number().int().min(0).max(43200) }),
  z.object({ key: z.literal(AJUSTES.encerrarApos), value: z.number().int().min(0).max(43200) }),
]);

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("settings").select("key, value, updated_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const porChave = Object.fromEntries((data ?? []).map((a) => [a.key, a]));

  const numero = (chave: string) => {
    const v = porChave[chave]?.value;
    return typeof v === "number" ? v : 0;
  };

  return NextResponse.json({
    lerImagens: porChave[AJUSTES.lerImagens]?.value !== false,
    atualizadoEm: porChave[AJUSTES.lerImagens]?.updated_at ?? null,
    devolverAoBot: numero(AJUSTES.devolverAoBot),
    encerrarApos: numero(AJUSTES.encerrarApos),
    /**
     * Sem a chave da Anthropic o ajuste não tem efeito nenhum, e a tela
     * precisa dizer isso — senão o gestor liga a chave, nada muda e a
     * conclusão é que o painel está quebrado.
     */
    temChaveImagem: serverEnv.midia.leImagem,
    temChaveAudio: serverEnv.midia.leAudio,
  });
}

export async function PATCH(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  if (!canManageKnowledge(agent.role)) {
    return NextResponse.json(
      { error: "Só gestores e administradores mudam os ajustes." },
      { status: 403 }
    );
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ajuste desconhecido" }, { status: 400 });
  }

  // Upsert, não update: empresa que nunca mexeu no ajuste não tem linha, e um
  // update mudaria zero linhas em silêncio — a tela diria "salvo" e nada teria
  // mudado.
  const supabase = await supabaseServer();
  const { error } = await supabase.from("settings").upsert(
    {
      company_id: agent.company_id,
      key: parsed.data.key,
      value: parsed.data.value,
      updated_by: agent.id,
    },
    { onConflict: "company_id,key" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
