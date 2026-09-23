/**
 * POST /api/internal/agent-failed
 * O workflow do n8n conta que o agente não conseguiu responder.
 *
 * Existe porque a falha do agente era invisível daqui: o webhook devolve 200
 * antes de a resposta existir, então quando o nó do Claude quebra, do lado do
 * painel a conversa apenas fica "Aguardando". Foi assim que o bot passou uma
 * semana mudo por falta de crédito na Anthropic, entre 16 e 23/09/2026, sem
 * nada na tela dizendo isso.
 *
 * O aviso fica aberto até o bot voltar a responder — quem o fecha é o primeiro
 * envio que der certo, em /api/internal/send.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  /** Onde a falha apareceu. A empresa sai daqui, e não do corpo do pedido. */
  conversationId: z.string().uuid(),
  /** O erro cru do provedor. É ele que diz se é crédito, credencial ou queda. */
  detalhe: z.string().max(2000).optional(),
});

/**
 * De texto de erro para frase de gente.
 *
 * O que o administrador precisa saber é o que ele tem de fazer, e "Bad request
 * - please check your parameters" não diz isso. A mensagem crua continua
 * guardada em `detalhe`.
 */
function motivoDe(detalhe: string | undefined): string {
  const t = (detalhe ?? "").toLowerCase();
  if (t.includes("credit balance")) return "Acabou o crédito da Anthropic.";
  if (t.includes("rate limit") || t.includes("429")) return "A Anthropic está limitando as chamadas.";
  if (t.includes("authentication") || t.includes("invalid x-api-key") || t.includes("401")) {
    return "A chave da Anthropic foi recusada.";
  }
  if (t.includes("overloaded") || t.includes("529")) return "A Anthropic está sobrecarregada.";
  return "O atendimento automático falhou ao responder.";
}

export async function POST(request: Request) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: conversa } = await db
    .from("conversations")
    .select("company_id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();

  if (!conversa) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const { error } = await db.rpc("registrar_falha_do_agente", {
    p_company_id: conversa.company_id,
    p_motivo: motivoDe(parsed.data.detalhe),
    p_detalhe: parsed.data.detalhe ?? null,
    p_conversation_id: parsed.data.conversationId,
  });

  if (error) {
    console.error("[agente] não consegui registrar a falha", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.error(`[agente] falhou: ${parsed.data.detalhe ?? "sem detalhe"}`);
  return NextResponse.json({ ok: true });
}
