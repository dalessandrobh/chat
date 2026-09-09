/**
 * POST /api/conversations/:id/reactivate
 * Devolve a palavra ao bot numa conversa que foi calada.
 *
 * Calar é automático; descalar não é. Quem olhou a conversa e discordou da
 * detecção clica aqui, e o marco d'água faz a detecção só olhar o que vier
 * depois — senão a mesma repetição de antes calaria tudo de novo no segundo
 * seguinte, e reativar não significaria nada.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("reativar_bot", { p_conversation_id: id });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, conversation: data });
}
