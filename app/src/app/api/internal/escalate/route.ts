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

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
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
  const { conversationId, reason } = parsed.data;

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
