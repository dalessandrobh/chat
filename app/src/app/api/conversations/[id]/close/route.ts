/**
 * POST   /api/conversations/:id/close — encerra
 * DELETE /api/conversations/:id/close — reabre
 *
 * Encerrar é arquivar: tira a conversa da lista de quem atende e não manda
 * nada ao cliente. Se ele voltar a escrever, o gatilho do banco reabre sozinho
 * — por isso a ação é reversível de dois jeitos, pela tela e pelo próprio
 * contato.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const supabase = await supabaseServer();

  // Pela sessão da pessoa: a função confere se a conversa é da empresa dela.
  const { data, error } = await supabase.rpc("close_conversation", { p_conversation_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ conversation: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("reopen_conversation", { p_conversation_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ conversation: data });
}
