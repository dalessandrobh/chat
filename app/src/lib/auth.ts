/** Helpers de autenticação para as rotas de API. */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

/** Agente logado no painel, ou null. */
export async function currentAgent() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: agent } = await supabase
    .from("agents")
    .select("id, full_name, role, is_active, company_id")
    .eq("id", user.id)
    .maybeSingle();

  // Sem empresa a pessoa não opera nada: é quem se cadastrou e ainda não foi
  // convidada. A tela mostra "acesso pendente"; as rotas devolvem 401.
  if (!agent?.is_active || !agent.company_id) return null;

  return agent as {
    id: string;
    full_name: string | null;
    role: string;
    is_active: boolean;
    company_id: string;
  };
}

export function unauthorized(message = "Não autenticado") {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Valida o Bearer que o n8n usa nas rotas /api/internal/*.
 * Comparação em tempo constante — o token é longo e vive num serviço
 * que qualquer workflow pode chamar.
 */
export function hasServiceToken(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(serverEnv.serviceToken);

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
