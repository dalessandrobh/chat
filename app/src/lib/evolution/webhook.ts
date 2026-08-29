/**
 * Verificação e normalização dos webhooks da Evolution API.
 *
 * Envelope (confirmado no código da v2.3.7):
 *   { event, instance, data, destination, date_time, sender, server_url, apikey }
 *
 * Duas diferenças em relação à Meta que moldam este arquivo:
 *
 *   1. Não há assinatura HMAC. A autenticação é um bearer que nós mesmos
 *      mandamos a Evolution repetir em todo webhook.
 *   2. Chega muito mais coisa: grupo, status/stories, e as mensagens que o
 *      próprio dono manda pelo celular. Filtrar aqui evita lixo no inbox.
 */

import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { isBroadcastJid, isGroupJid, jidToWaId } from "@/lib/evolution/client";

// -----------------------------------------------------------------------------
// Autenticação
// -----------------------------------------------------------------------------

/** Compara em tempo constante para não vazar o token por timing. */
export function verifyWebhookToken(authorizationHeader: string | null): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;

  const received = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(serverEnv.evolution.webhookToken);

  if (received.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(received, expected);
}

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

export interface EvolutionEnvelope {
  event?: string;
  instance?: string;
  data?: Record<string, any>;
  date_time?: string;
  sender?: string;
  server_url?: string;
}

export interface EvoInboundMessage {
  kind: "message";
  waMessageId: string;
  instanceName: string;
  from: string;
  profileName: string | null;
  timestamp: Date;
  type: string;
  body: string | null;
  payload: Record<string, any>;
  media: { mimeType: string; base64: string | null; filename?: string; seconds?: number } | null;
  repliedTo: string | null;
  /** Mensagem que o dono mandou pelo celular, não pelo painel. */
  fromMe: boolean;
}

export interface EvoStatusUpdate {
  kind: "status";
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
}

export interface EvoConnectionUpdate {
  kind: "connection";
  instanceName: string;
  state: "open" | "connecting" | "close";
}

export type EvoEvent = EvoInboundMessage | EvoStatusUpdate | EvoConnectionUpdate;

// -----------------------------------------------------------------------------
// Tipos de mensagem do Baileys → nosso vocabulário
// -----------------------------------------------------------------------------

const MESSAGE_TYPE: Record<string, string> = {
  conversation: "text",
  extendedTextMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  contactMessage: "contact",
  contactsArrayMessage: "contact",
  reactionMessage: "reaction",
  listResponseMessage: "interactive",
  buttonsResponseMessage: "interactive",
  templateButtonReplyMessage: "interactive",
};

/**
 * Texto legível de qualquer tipo. A Evolution já normaliza extendedTextMessage
 * para `conversation`, mas o campo antigo aparece em mensagem citada — por isso
 * as duas leituras.
 */
function extractBody(message: Record<string, any>): string | null {
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    message.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    message.listResponseMessage?.title ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.templateButtonReplyMessage?.selectedDisplayText ??
    message.reactionMessage?.text ??
    (message.locationMessage
      ? `📍 ${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}`
      : null) ??
    null
  );
}

/** O nó que carrega a mídia, qualquer que seja o tipo. */
function mediaNode(message: Record<string, any>): Record<string, any> | null {
  return (
    message.imageMessage ??
    message.videoMessage ??
    message.audioMessage ??
    message.documentMessage ??
    message.documentWithCaptionMessage?.message?.documentMessage ??
    message.stickerMessage ??
    null
  );
}

// -----------------------------------------------------------------------------
// Normalização
// -----------------------------------------------------------------------------

const STATUS_MAP: Record<string, EvoStatusUpdate["status"]> = {
  PENDING: "sent",
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

export function parseWebhook(envelope: EvolutionEnvelope): EvoEvent[] {
  const event = (envelope.event ?? "").toLowerCase().replace(/-/g, ".");
  const instanceName = envelope.instance ?? "";
  const data = envelope.data ?? {};

  switch (event) {
    case "messages.upsert":
      return parseInbound(instanceName, data);
    case "messages.update":
      return parseStatus(data);
    case "connection.update":
      return parseConnection(instanceName, data);
    default:
      // send.message e qrcode.updated chegam e não têm o que fazer aqui:
      // o envio já foi gravado por quem enviou, e o QR é lido sob demanda.
      return [];
  }
}

function parseInbound(instanceName: string, data: Record<string, any>): EvoEvent[] {
  const key = data.key ?? {};
  const remoteJid: string = key.remoteJid ?? "";

  if (!key.id || !remoteJid) return [];

  // Grupo e stories não viram conversa. Suportar grupo exige repensar o
  // handoff inteiro (quem é "o contato"?), então fica de fora até fazer falta.
  if (isGroupJid(remoteJid) || isBroadcastJid(remoteJid)) return [];

  const message: Record<string, any> = data.message ?? {};
  const rawType: string = data.messageType ?? Object.keys(message)[0] ?? "unknown";
  const media = mediaNode(message);

  return [
    {
      kind: "message",
      waMessageId: key.id,
      instanceName,
      from: jidToWaId(remoteJid),
      profileName: data.pushName ?? null,
      timestamp: toDate(data.messageTimestamp),
      type: MESSAGE_TYPE[rawType] ?? "unknown",
      body: extractBody(message),
      payload: message,
      media: media
        ? {
            mimeType: media.mimetype ?? "application/octet-stream",
            // Vem preenchido porque pedimos base64:true na configuração do
            // webhook; se vier vazio, dá para buscar depois pelo id.
            base64: message.base64 ?? null,
            filename: media.fileName ?? media.title,
            seconds: media.seconds,
          }
        : null,
      repliedTo: data.contextInfo?.stanzaId ?? message?.[rawType]?.contextInfo?.stanzaId ?? null,
      fromMe: Boolean(key.fromMe),
    },
  ];
}

function parseStatus(data: Record<string, any>): EvoEvent[] {
  const id = data.keyId ?? data.key?.id;
  const status = STATUS_MAP[String(data.status ?? "").toUpperCase()];
  if (!id || !status) return [];

  return [{ kind: "status", waMessageId: id, status, timestamp: new Date() }];
}

function parseConnection(instanceName: string, data: Record<string, any>): EvoEvent[] {
  const state = data.state ?? data.connection;
  if (state !== "open" && state !== "connecting" && state !== "close") return [];

  return [{ kind: "connection", instanceName, state }];
}

/** messageTimestamp vem em segundos; às vezes como string. */
function toDate(timestamp: unknown): Date {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1000);
}
