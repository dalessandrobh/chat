/**
 * POST /api/internal/escalate
 * O bot passa a conversa para a fila humana.
 *
 * Usado quando o workflow detecta "quero falar com um atendente", ou quando
 * cai no fallback por não entender o pedido. Diferente de take_over(), aqui
 * não há agente logado: a conversa vai para `pending`, sem dono, e aparece
 * destacada no painel.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/messages";

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  /**
   * Última fala do bot, entregue ANTES de a conversa virar humana.
   *
   * Sem isto o cliente fica no vácuo: o bot escala, o modo vira `human`, e a
   * despedida que ele tentaria mandar depois esbarra na própria trava de
   * handoff e volta 409. A ordem importa, então o envio mora aqui dentro.
   */
  message: z.string().max(1000).optional(),
});

export async function POST(request: Request) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { conversationId, reason, message } = parsed.data;

  const { data: before } = await db
    .from("conversations")
    .select("mode")
    .eq("id", conversationId)
    .maybeSingle();

  if (!before) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  // Já está com humano: nada a fazer, e não vale poluir a auditoria.
  if (before.mode === "human") {
    return NextResponse.json({ ok: true, alreadyHuman: true });
  }

  // Falar primeiro, transferir depois. Se o envio falhar, a transferência
  // acontece do mesmo jeito: é pior deixar a conversa presa no bot do que
  // deixá-la sem a mensagem de despedida.
  if (message) {
    const enviada = await sendTextMessage({
      conversationId,
      text: message,
      author: "bot",
    });
    if (!enviada.ok) {
      console.error(`[escalate] despedida não enviada: ${enviada.message}`);
    }
  }

  const { error } = await db
    .from("conversations")
    .update({
      mode: "human",
      status: "pending",
      assigned_agent_id: null,
      bot_resume_at: null,
    })
    .eq("id", conversationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from("handoff_events").insert({
    conversation_id: conversationId,
    from_mode: "bot",
    to_mode: "human",
    actor: "bot",
    reason: reason ?? "Escalado pela automação",
  });

  return NextResponse.json({ ok: true });
}
