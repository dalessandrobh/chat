/**
 * POST /api/channels/:id/logout — desconecta o celular para trocar de número
 *
 * O canal continua o mesmo: conversas, contatos, campanhas e templates ficam
 * onde estão, e o próximo QR pareia outro aparelho no lugar. É isso que
 * diferencia trocar o número de cadastrar um canal novo — trocar mantém a
 * história, cadastrar começa do zero.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageChannels } from "@/lib/roles";
import { EvolutionApiError, logoutInstance } from "@/lib/evolution/client";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  if (!canManageChannels(agent.role)) {
    return NextResponse.json({ error: "Só administradores trocam o número." }, { status: 403 });
  }

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: channel } = await db
    .from("channels")
    .select("id, provider, instance_name")
    .eq("id", id)
    .maybeSingle();

  if (!channel) return NextResponse.json({ error: "Canal não encontrado" }, { status: 404 });

  if (channel.provider !== "evolution" || !channel.instance_name) {
    return NextResponse.json(
      { error: "Só canais Evolution são pareados por QR." },
      { status: 400 }
    );
  }

  try {
    await logoutInstance(channel.instance_name);
  } catch (err) {
    // Já deslogado devolve erro, e isso não é motivo para deixar o banco
    // dizendo que o número antigo continua lá.
    const message = err instanceof EvolutionApiError ? err.message : String(err);
    console.error(`[canal] logout devolveu erro: ${message}`);
  }

  // O número some junto: é o que faz a tela voltar a procurá-lo depois do
  // próximo pareamento, em vez de mostrar o antigo.
  const { error } = await db
    .from("channels")
    .update({ connection_state: "close", display_phone_number: null, connected_at: null })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
