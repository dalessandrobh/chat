/**
 * Cliente da Evolution API (WhatsApp via Baileys).
 *
 * Espelha o papel de lib/meta/client.ts: é o único lugar do sistema que fala
 * HTTP com a Evolution. Rotas conferidas contra o código da v2.3.7 —
 * `/message/*`, `/instance/*` e `/webhook/*`, todas com o nome da instância
 * no fim do caminho.
 *
 * Diferença de fundo em relação à Meta: aqui não existe janela de 24h nem
 * template aprovado. O que existe, e a Meta não tem, é a sessão — um pareamento
 * que cai. Metade do tratamento de erro daqui é sobre isso.
 */

import { serverEnv } from "@/lib/env";

export class EvolutionApiError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, details: Record<string, unknown> | null, fallback?: string) {
    super(extractMessage(details) ?? fallback ?? `Erro da Evolution API (HTTP ${status})`);
    this.name = "EvolutionApiError";
    this.status = status;
    this.details = details;
  }

  /**
   * A instância não está pareada. Acontece quando o WhatsApp derruba o
   * dispositivo — e é o erro que o dono precisa ver no painel, porque a
   * solução é humana: ler o QR de novo.
   */
  get isDisconnected(): boolean {
    if (this.status === 404) return true;
    const text = this.message.toLowerCase();
    return (
      text.includes("connection closed") ||
      text.includes("not connected") ||
      text.includes("does not exist") ||
      text.includes("close")
    );
  }

  /** O número não tem WhatsApp. Vale marcar o contato, não retentar. */
  get isInvalidNumber(): boolean {
    return this.message.toLowerCase().includes("exists\":false") ||
      this.message.toLowerCase().includes("number not");
  }
}

/**
 * A Evolution é irregular no formato do erro: às vezes string, às vezes lista,
 * e no caso mais útil de todos — número sem WhatsApp — uma lista de objetos
 * `[{exists: false, number: "…"}]`. `String(objeto)` daria "[object Object]" e
 * o painel perderia justamente o motivo. Serializa como JSON, que é também o
 * formato que `isInvalidNumber` procura.
 */
function toText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const partes = value.map(toText).filter((v): v is string => v !== null);
    return partes.length ? partes.join("; ") : null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return toText(obj.message) ?? toText(obj.error) ?? JSON.stringify(value);
  }
  return null;
}

/** A Evolution devolve `message` ora string, ora array, ora aninhado em `response`. */
function extractMessage(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const candidates = [
    details.message,
    (details.response as Record<string, unknown> | undefined)?.message,
    details.error,
  ];
  for (const value of candidates) {
    const texto = toText(value);
    if (texto) return texto;
  }
  return null;
}

async function evoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${serverEnv.evolution.baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serverEnv.evolution.apiKey,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    // Baileys às vezes demora a resolver o envio; 20s é o teto que o painel
    // aguenta sem parecer travado.
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // A Evolution devolve HTML em alguns 502. Não deixar o JSON.parse mascarar.
    if (!response.ok) throw new EvolutionApiError(response.status, null, text.slice(0, 200));
  }

  if (!response.ok) {
    throw new EvolutionApiError(response.status, json as Record<string, unknown>);
  }
  return json as T;
}

// -----------------------------------------------------------------------------
// Identificadores
// -----------------------------------------------------------------------------

/**
 * O Baileys trabalha com JID (`5511999998888@s.whatsapp.net`); o banco guarda
 * só o número, como a Meta entrega. A tradução mora aqui para não vazar `@`
 * para dentro de chat.contacts.
 */
export function jidToWaId(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/** Mensagem de status/stories, que chega junto e não é conversa. */
export function isBroadcastJid(jid: string): boolean {
  return jid.endsWith("@broadcast") || jid === "status@broadcast";
}

// -----------------------------------------------------------------------------
// Envio
// -----------------------------------------------------------------------------

/** Resposta de envio: é a mensagem do Baileys, já persistida pela Evolution. */
export interface EvolutionSendResult {
  key: { remoteJid: string; fromMe: boolean; id: string };
  message?: Record<string, unknown>;
  messageTimestamp?: number | string;
  status?: string;
}

export interface SendOptions {
  /** Milissegundos de "digitando…" antes de entregar. Deixa menos robótico. */
  delay?: number;
  /** id da mensagem sendo respondida */
  quotedId?: string;
  linkPreview?: boolean;
}

function quotedPayload(quotedId?: string) {
  // A Evolution exige key + message no `quoted`; message vazio é aceito e
  // evita ter que recarregar a mensagem original só para citar.
  return quotedId ? { quoted: { key: { id: quotedId }, message: {} } } : {};
}

export function sendText(
  instance: string,
  to: string,
  text: string,
  opts: SendOptions = {}
): Promise<EvolutionSendResult> {
  return evoFetch<EvolutionSendResult>(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      text,
      delay: opts.delay ?? 0,
      linkPreview: opts.linkPreview ?? true,
      ...quotedPayload(opts.quotedId),
    }),
  });
}

export type EvolutionMediaType = "image" | "document" | "video" | "audio";

export function sendMedia(
  instance: string,
  to: string,
  media: {
    mediatype: EvolutionMediaType;
    /** URL pública ou base64 puro (sem o prefixo data:) */
    media: string;
    mimetype?: string;
    caption?: string;
    fileName?: string;
  },
  opts: SendOptions = {}
): Promise<EvolutionSendResult> {
  return evoFetch<EvolutionSendResult>(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      ...media,
      delay: opts.delay ?? 0,
      ...quotedPayload(opts.quotedId),
    }),
  });
}

/**
 * Áudio como mensagem de voz (aquele balãozinho), não como arquivo anexado.
 * Endpoint separado no Baileys porque o encoding é outro.
 */
export function sendWhatsAppAudio(
  instance: string,
  to: string,
  audio: string,
  opts: SendOptions = {}
): Promise<EvolutionSendResult> {
  return evoFetch<EvolutionSendResult>(
    `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`,
    {
      method: "POST",
      body: JSON.stringify({ number: to, audio, delay: opts.delay ?? 0, ...quotedPayload(opts.quotedId) }),
    }
  );
}

/** Marca como lida no celular do dono, para o WhatsApp Web não ficar sujo. */
export function markAsRead(
  instance: string,
  messages: Array<{ remoteJid: string; fromMe: boolean; id: string }>
): Promise<unknown> {
  return evoFetch(`/chat/markMessageAsRead/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ readMessages: messages }),
  });
}

/** Baixa a mídia de uma mensagem recebida, já decriptada, em base64. */
export function getMediaBase64(
  instance: string,
  messageId: string,
  convertToMp4 = false
): Promise<{ mediaType: string; fileName: string; base64: string; mimetype: string }> {
  return evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4 }),
  });
}

// -----------------------------------------------------------------------------
// Instância — criar, parear, monitorar
// -----------------------------------------------------------------------------

export interface InstanceConnectResult {
  /** QR em data:image/png;base64,… pronto para <img src>. */
  base64?: string;
  /** Mesmo QR em texto, se preferir renderizar do lado do cliente. */
  code?: string;
  /** Código de 8 dígitos para parear sem câmera. */
  pairingCode?: string;
  count?: number;
}

export interface InstanceState {
  instance: { instanceName: string; state: "open" | "connecting" | "close" };
}

export function createInstance(input: {
  instanceName: string;
  webhookUrl: string;
  webhookToken: string;
  events?: string[];
}): Promise<Record<string, unknown>> {
  return evoFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: input.instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: webhookConfig(input.webhookUrl, input.webhookToken, input.events),
    }),
  });
}

/** Devolve o QR. Chamar de novo gera outro: o QR expira em ~40s. */
export function connectInstance(instance: string): Promise<InstanceConnectResult> {
  return evoFetch(`/instance/connect/${encodeURIComponent(instance)}`);
}

export interface InstanceInfo {
  name?: string;
  instanceName?: string;
  connectionStatus?: string;
  /** JID do número pareado, ex.: 5531999998888@s.whatsapp.net */
  ownerJid?: string;
  profileName?: string;
}

/**
 * Lista as instâncias. É o único endpoint que devolve o número pareado —
 * connectionState só diz se está de pé.
 */
export function fetchInstances(): Promise<InstanceInfo[]> {
  return evoFetch<InstanceInfo[]>("/instance/fetchInstances");
}

export function connectionState(instance: string): Promise<InstanceState> {
  return evoFetch(`/instance/connectionState/${encodeURIComponent(instance)}`);
}

export function logoutInstance(instance: string): Promise<unknown> {
  return evoFetch(`/instance/logout/${encodeURIComponent(instance)}`, { method: "DELETE" });
}

/** Eventos que nos interessam. Assinar tudo só enche o log. */
export const WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
] as const;

function webhookConfig(url: string, token: string, events?: string[]) {
  return {
    enabled: true,
    url,
    // A Evolution não assina o corpo; o segredo vai no header e é conferido
    // do nosso lado.
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // Tudo numa URL só. byEvents=true criaria /messages-upsert, /connection-update…
    byEvents: false,
    // Mídia já decriptada no próprio evento: evita uma segunda chamada por áudio.
    base64: true,
    events: events ?? [...WEBHOOK_EVENTS],
  };
}

export function setWebhook(
  instance: string,
  url: string,
  token: string,
  events?: string[]
): Promise<unknown> {
  return evoFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ webhook: webhookConfig(url, token, events) }),
  });
}

export function findWebhook(instance: string): Promise<Record<string, unknown>> {
  return evoFetch(`/webhook/find/${encodeURIComponent(instance)}`);
}
