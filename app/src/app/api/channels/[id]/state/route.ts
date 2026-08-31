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
import {
  EvolutionApiError,
  connectionState,
  fetchInstances,
  jidToWaId,
} from "@/lib/evolution/client";
import { conexaoDoCanal } from "@/lib/canais";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: channel } = await db
    .from("channels")
    .select("id, provider, instance_name, connection_state, display_phone_number")
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
    const conn = await conexaoDoCanal(channel.id);
    const result = await connectionState(conn, channel.instance_name);
    const state = result.instance?.state ?? "unknown";

    const patch: Record<string, unknown> = {};

    // Mantém o banco em dia mesmo se o webhook tiver se perdido.
    if (state !== channel.connection_state) {
      patch.connection_state = state;
      if (state === "open") patch.connected_at = new Date().toISOString();
    }

    // Qual número foi pareado só se descobre depois da leitura do QR, e só
    // fetchInstances conta. Buscamos uma vez e guardamos.
    if (state === "open" && !channel.display_phone_number) {
      const instances = await fetchInstances(conn).catch(() => []);
      const found = instances.find(
        (i) => (i.name ?? i.instanceName) === channel.instance_name
      );
      if (found?.ownerJid) patch.display_phone_number = jidToWaId(found.ownerJid);
    }

    if (Object.keys(patch).length > 0) {
      await db.from("channels").update(patch).eq("id", id);
    }

    return NextResponse.json({ state });
  } catch (err) {
    const message = err instanceof EvolutionApiError ? err.message : String(err);
    return NextResponse.json({ state: "unknown", error: message }, { status: 200 });
  }
}
