/**
 * POST /api/channels/:id/connect
 * Gera um QR novo para parear a instância.
 *
 * O QR do WhatsApp expira em cerca de 40 segundos — por isso é uma ação, não
 * um dado da página: quem está olhando a tela pede outro quando o anterior
 * vence.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { EvolutionApiError, connectInstance } from "@/lib/evolution/client";
import { conexaoDoCanal } from "@/lib/canais";
import { canManageChannels } from "@/lib/roles";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  // Parear um número é dar acesso a todas as conversas dele. Fica com quem
  // administra, não com quem atende.
  if (!canManageChannels(agent.role)) {
    return NextResponse.json({ error: "Só administradores conectam canais." }, { status: 403 });
  }

  const { id } = await params;

  const { data: channel } = await supabaseAdmin()
    .from("channels")
    .select("id, provider, instance_name")
    .eq("id", id)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ error: "Canal não encontrado" }, { status: 404 });
  }
  if (channel.provider !== "evolution" || !channel.instance_name) {
    return NextResponse.json(
      { error: "Só canais Evolution são pareados por QR." },
      { status: 400 }
    );
  }

  try {
    const result = await connectInstance(await conexaoDoCanal(channel.id), channel.instance_name);
    return NextResponse.json({
      qrcode: result.base64 ?? null,
      pairingCode: result.pairingCode ?? null,
    });
  } catch (err) {
    const message = err instanceof EvolutionApiError ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
