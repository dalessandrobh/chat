/**
 * Verificação e normalização dos webhooks da Meta.
 *
 * A Meta manda um envelope bem aninhado (entry > changes > value) que pode
 * conter várias mensagens e vários status numa única requisição. Este módulo
 * achata isso em eventos simples.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

// -----------------------------------------------------------------------------
// Assinatura
// -----------------------------------------------------------------------------

/**
 * Confere o header X-Hub-Signature-256.
 *
 * Precisa do corpo CRU, byte a byte — se o body for parseado e re-serializado
 * antes daqui, o HMAC não bate. Comparação em tempo constante para não vazar
 * informação por timing.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const received = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", serverEnv.meta.appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  // timingSafeEqual lança se os tamanhos diferirem; checamos antes.
  if (a.length !== b.length || a.length === 0) return false;

  return timingSafeEqual(a, b);
}

/** Handshake de verificação (GET) que a Meta faz ao cadastrar a URL. */
export function verifyChallenge(params: URLSearchParams): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === serverEnv.meta.verifyToken && challenge) {
    return challenge;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Tipos do payload
// -----------------------------------------------------------------------------

export interface WebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{ field: string; value: Record<string, any> }>;
  }>;
}

export interface InboundMessage {
  kind: "message";
  waMessageId: string;
  phoneNumberId: string;
  from: string;
  profileName: string | null;
  timestamp: Date;
  type: string;
  /** Texto plano, para preview e busca. Null em mídia sem legenda. */
  body: string | null;
  /** Conteúdo específico do tipo, já desembrulhado. */
  payload: Record<string, any>;
  media: { mediaId: string; mimeType: string; sha256?: string; filename?: string } | null;
  repliedTo: string | null;
}

export interface StatusUpdate {
  kind: "status";
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  recipientId: string;
  error: Record<string, any> | null;
}

export interface TemplateStatusUpdate {
  kind: "template_status";
  templateName: string;
  language: string;
  event: string;
  reason: string | null;
}

export type WebhookEvent = InboundMessage | StatusUpdate | TemplateStatusUpdate;

// -----------------------------------------------------------------------------
// Normalização
// -----------------------------------------------------------------------------

const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

/** Extrai o texto legível de qualquer tipo de mensagem. */
function extractBody(message: Record<string, any>): string | null {
  switch (message.type) {
    case "text":
      return message.text?.body ?? null;
    case "button":
      return message.button?.text ?? null;
    case "interactive":
      // Resposta de botão ou de lista
      return (
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        null
      );
    case "reaction":
      return message.reaction?.emoji ?? null;
    case "location":
      return message.location?.name ?? message.location?.address ?? null;
    case "order":
      return "Pedido do catálogo";
    default:
      // Mídia costuma trazer legenda
      return message[message.type]?.caption ?? null;
  }
}

function extractMedia(message: Record<string, any>): InboundMessage["media"] {
  if (!MEDIA_TYPES.has(message.type)) return null;
  const node = message[message.type];
  if (!node?.id) return null;

  return {
    mediaId: node.id,
    mimeType: node.mime_type ?? "application/octet-stream",
    sha256: node.sha256,
    filename: node.filename,
  };
}

/**
 * Achata o envelope da Meta em eventos individuais.
 * Nunca lança: um payload malformado vira lista vazia, e o webhook responde
 * 200 mesmo assim — senão a Meta reentrega em loop.
 */
export function parseWebhook(payload: WebhookPayload): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // --- Atualização de status de template (aprovado/rejeitado) ---
      if (change.field === "message_template_status_update") {
        events.push({
          kind: "template_status",
          templateName: value.message_template_name,
          language: value.message_template_language,
          event: value.event,
          reason: value.reason ?? null,
        });
        continue;
      }

      const phoneNumberId: string = value.metadata?.phone_number_id ?? "";

      // O nome do perfil vem num array separado das mensagens.
      const profileByWaId = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          profileByWaId.set(contact.wa_id, contact.profile.name);
        }
      }

      // --- Mensagens recebidas ---
      for (const message of value.messages ?? []) {
        events.push({
          kind: "message",
          waMessageId: message.id,
          phoneNumberId,
          from: message.from,
          profileName: profileByWaId.get(message.from) ?? null,
          // A Meta manda epoch em SEGUNDOS, não milissegundos.
          timestamp: new Date(Number(message.timestamp) * 1000),
          type: message.type,
          body: extractBody(message),
          payload: message[message.type] ?? {},
          media: extractMedia(message),
          repliedTo: message.context?.id ?? null,
        });
      }

      // --- Status de mensagens que enviamos ---
      for (const status of value.statuses ?? []) {
        events.push({
          kind: "status",
          waMessageId: status.id,
          status: status.status,
          timestamp: new Date(Number(status.timestamp) * 1000),
          recipientId: status.recipient_id,
          error: status.errors?.[0] ?? null,
        });
      }
    }
  }

  return events;
}
