/**
 * GET /api/platform — visão de todas as empresas, para quem opera a plataforma
 *
 * Esta é a exceção que **não** está dentro da regra de acesso. Nenhuma política
 * ganhou um "ou é o dono da plataforma": toda porta de fuga dentro da RLS é um
 * vazamento esperando, e o erro seria invisível. Aqui o caminho é outro —
 * confere quem está pedindo, usa a chave de serviço de propósito, e registra.
 *
 * O que devolve é medida, não conteúdo: quantas conversas, quantas mensagens,
 * quando foi a última. Ler conversa de cliente é outra decisão, e vai precisar
 * de outra porta.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data: ehDono } = await supabase.rpc("is_platform_owner");
  if (!ehDono) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.rpc("platform_overview");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("platform_access_log").insert({
    actor_id: user.id,
    action: "listou as empresas",
    detail: { empresas: (data as unknown[])?.length ?? 0 },
  });

  const { data: log } = await db
    .from("platform_access_log")
    .select("action, created_at, detail, agents(full_name)")
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ empresas: data ?? [], log: log ?? [] });
}
