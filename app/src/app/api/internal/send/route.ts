/**
 * POST /api/internal/send
 * Envio feito pela automação do n8n. Autenticado por Bearer service token.
 *
 * A trava central do projeto está aqui: se a conversa foi assumida por um
 * humano, o bot é recusado. Sem isso, um workflow atrasado poderia responder
 * por cima do atendente no meio do atendimento.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  type SendOutcome,
} from "@/lib/messages";

const bodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(4096),
  }),
  z.object({
    type: z.literal("template"),
    conversationId: z.string().uuid(),
    templateId: z.string().uuid(),
    variables: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("media"),
    conversationId: z.string().uuid(),
    kind: z.enum(["image", "audio", "video", "document", "sticker"]),
    link: z.string().url().optional(),
    mediaId: z.string().optional(),
    caption: z.string().max(1024).optional(),
    filename: z.string().optional(),
  }),
]);

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  outside_window: 409,
  template_not_approved: 409,
  // Sessão da Evolution caída: é indisponibilidade temporária, e 503 diz ao
  // n8n que vale a pena retentar — ao contrário dos 409 acima.
  disconnected: 503,
  meta_error: 502,
};

export async function POST(request: Request) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // --- Trava do handoff ---
  const { data: conversation } = await supabaseAdmin()
    .from("conversations")
    .select("id, mode")
    .eq("id", input.conversationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  if (conversation.mode === "human") {
    // 409, não 403: é um conflito de estado temporário. O workflow deve
    // simplesmente encerrar este ramo, não tratar como erro fatal.
    return NextResponse.json(
      {
        error: "Conversa em atendimento humano; o bot não envia agora.",
        reason: "human_takeover",
        skipped: true,
      },
      { status: 409 }
    );
  }

  let result: SendOutcome;
  switch (input.type) {
    case "text":
      result = await sendTextMessage({
        conversationId: input.conversationId,
        text: input.text,
        author: "bot",
      });
      break;
    case "template":
      result = await sendTemplateMessage({
        conversationId: input.conversationId,
        templateId: input.templateId,
        variables: input.variables,
        author: "bot",
      });
      break;
    case "media":
      result = await sendMediaMessage({
        conversationId: input.conversationId,
        kind: input.kind,
        link: input.link,
        mediaId: input.mediaId,
        caption: input.caption,
        filename: input.filename,
        author: "bot",
      });
      break;
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: STATUS_BY_REASON[result.reason] ?? 400 }
    );
  }

  return NextResponse.json(result);
}
