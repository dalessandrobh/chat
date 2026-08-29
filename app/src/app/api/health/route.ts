import { NextResponse } from "next/server";

/** Healthcheck do container. Não toca o banco de propósito: só diz se o
 *  processo Node está de pé, que é o que o Docker precisa saber. */
export function GET() {
  return NextResponse.json({ ok: true, service: "chat-painel" });
}
