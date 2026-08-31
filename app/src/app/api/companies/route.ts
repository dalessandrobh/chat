/**
 * POST /api/companies — a pessoa cria a própria empresa
 *
 * É o passo que faltava para o autoatendimento existir: quem se cadastra nasce
 * sem empresa, e enquanto existir uma só o gatilho adivinha. Na segunda, sem
 * isto, a pessoa fica presa na tela de acesso pendente para sempre.
 *
 * Quem cria vira administrador dela. A função no banco recusa quem já tem
 * empresa — senão o cadastro viraria um jeito de encher o banco.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().trim().min(2, "Dê um nome à empresa").max(80),
});

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  // Pela sessão da pessoa: a função confere que ela ainda não tem empresa.
  const { data, error } = await supabase.rpc("create_company", {
    p_name: parsed.data.name,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ companyId: data });
}
