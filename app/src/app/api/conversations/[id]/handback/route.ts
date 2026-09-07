/**
 * POST /api/conversations/:id/handback
 * Devolve a conversa para a automação do n8n.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { sendTextMessage } from "@/lib/messages";
import { mensagemDevolveu } from "@/lib/handoff-messages";

const bodySchema = z
  .object({
    reason: z.string().max(500).optional(),
    /** Devolver ao bot uma conversa que está com outro atendente. */
    force: z.boolean().default(false),
  })
  .refine((b) => !b.force || (b.reason?.trim().length ?? 0) >= 3, {
    message: "Diga o motivo para devolver a conversa de outro atendente",
    path: ["reason"],
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = await supabaseServer();

  // O nome da empresa vai junto: é o que o cliente ouve na despedida, e com
  // várias no mesmo painel ele não pode ouvir o nome de outra.
  const { data: antes } = await supabase
    .from("conversations")
    .select("mode, companies(name)")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase.rpc("hand_back", {
    p_conversation_id: id,
    p_reason: parsed.data.reason ?? null,
    p_force: parsed.data.force,
  });

  if (error) {
    // Devolver ao bot encerra o atendimento humano e despede o cliente. Se
    // responder na conversa de outro atendente é proibido, tirá-la dele não
    // pode ser livre — daí a mesma recusa por conflito.
    const status = error.code === "PT409" ? 409 : 400;
    return NextResponse.json({ error: error.message, conflict: status === 409 }, { status });
  }

  // Só avisa quem realmente saiu do atendimento humano.
  if (antes?.mode === "human") {
    const resultado = await sendTextMessage({
      conversationId: id,
      text: mensagemDevolveu(
        (antes as unknown as { companies: { name: string } | null }).companies?.name ??
          "nossa equipe"
      ),
      author: "bot",
    });
    if (!resultado.ok) {
      console.error(`[handback] aviso não enviado: ${resultado.message}`);
    }
  }

  return NextResponse.json({ ok: true, conversation: data });
}
