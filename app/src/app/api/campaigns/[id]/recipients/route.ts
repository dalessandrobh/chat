/**
 * GET /api/campaigns/:id/recipients — o log de uma campanha, um por contato
 *
 * Os números do cartão dizem quantos; este endereço diz **quem**, e por quê.
 * É a diferença entre "5 falharam" e "os cinco falharam porque o WhatsApp
 * daquele número estava desconectado" — a segunda frase é a única sobre a qual
 * dá para agir.
 *
 * `?status=` filtra, porque é assim que a tela chega aqui: clicando no número
 * que se quer entender.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

/** Teto de linhas. Campanha de mil não vira uma página de mil. */
const LIMITE = 300;

const STATUS = ["pending", "sent", "delivered", "read", "failed", "skipped"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const pedido = new URL(request.url).searchParams.get("status")?.trim();
  const supabase = await supabaseServer();

  let query = supabase
    .from("campaign_recipients")
    .select("id, name, wa_id, status, error, sent_at, delivered_at, read_at, failed_at")
    // Do mais recente: quem está tentando entender uma campanha quer o que
    // acabou de acontecer, não o começo dela.
    .order("failed_at", { ascending: false, nullsFirst: false })
    .order("delivered_at", { ascending: false, nullsFirst: false })
    .order("sent_at", { ascending: false, nullsFirst: false })
    .eq("campaign_id", id)
    .limit(LIMITE);

  // `entregues` no cartão inclui quem já leu — o log segue a mesma conta, senão
  // o número clicado e a lista aberta discordariam.
  if (pedido === "delivered") query = query.in("status", ["delivered", "read"]);
  else if (pedido && STATUS.includes(pedido)) query = query.eq("status", pedido);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  return NextResponse.json({
    destinatarios: data ?? [],
    /** Total da campanha, para a tela dizer quando a lista foi cortada. */
    total: count ?? 0,
    limite: LIMITE,
  });
}
