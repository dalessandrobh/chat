/**
 * GET /api/channels/:id/state
 * Estado do pareamento, perguntado direto à Evolution.
 *
 * O webhook CONNECTION_UPDATE também mantém chat.channels atualizado, mas
 * durante o pareamento a tela precisa saber em segundos se o QR foi lido —
 * e aí perguntar é mais barato que esperar o evento chegar.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { EvolutionApiError, connectionState } from "@/lib/evolution/client";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: channel } = await db
    .from("channels")
    .select("id, provider, instance_name, connection_state")
    .eq("id", id)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ error: "Canal não encontrado" }, { status: 404 });
  }
  if (channel.provider !== "evolution" || !channel.instance_name) {
    // Canal da Meta não tem sessão para cair.
    return NextResponse.json({ state: "open" });
  }

  try {
    const result = await connectionState(channel.instance_name);
    const state = result.instance?.state ?? "unknown";

    // Mantém o banco em dia mesmo se o webhook tiver se perdido.
    if (state !== channel.connection_state) {
      await db
        .from("channels")
        .update({
          connection_state: state,
          ...(state === "open" ? { connected_at: new Date().toISOString() } : {}),
        })
        .eq("id", id);
    }

    return NextResponse.json({ state });
  } catch (err) {
    const message = err instanceof EvolutionApiError ? err.message : String(err);
    return NextResponse.json({ state: "unknown", error: message }, { status: 200 });
  }
}
