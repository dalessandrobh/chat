/**
 * POST /api/messages/send
 * Envio feito por um agente humano pelo painel.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { currentAgent, unauthorized } from "@/lib/auth";
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
    replyTo: z.string().optional(),
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

/** Traduz o motivo da recusa para o código HTTP certo. */
const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  outside_window: 409,
  template_not_approved: 409,
  meta_error: 502,
};

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const input = parsed.data;
  let result: SendOutcome;

  switch (input.type) {
    case "text":
      result = await sendTextMessage({
        conversationId: input.conversationId,
        text: input.text,
        author: "agent",
        agentId: agent.id,
        replyTo: input.replyTo,
      });
      break;

    case "template":
      result = await sendTemplateMessage({
        conversationId: input.conversationId,
        templateId: input.templateId,
        variables: input.variables,
        author: "agent",
        agentId: agent.id,
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
        author: "agent",
        agentId: agent.id,
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
