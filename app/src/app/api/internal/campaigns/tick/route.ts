/**
 * POST /api/internal/campaigns/tick
 *
 * Mesmo passo que o relógio interno dá sozinho. Existe para quem quiser tirar
 * o agendamento de dentro do painel — um Schedule do n8n, um cron — sem
 * reescrever nada.
 */

import { NextResponse } from "next/server";
import { hasServiceToken } from "@/lib/auth";
import { tick } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  try {
    return NextResponse.json(await tick());
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}
