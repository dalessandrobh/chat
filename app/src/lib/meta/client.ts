/**
 * Cliente da WhatsApp Cloud API (Meta Graph API).
 *
 * Todo envio para o WhatsApp passa por aqui. O painel e o n8n nunca chamam
 * a Graph API direto — assim o log, a regra da janela de 24h e o tratamento
 * de erro ficam num lugar só.
 */

import { serverEnv } from "@/lib/env";

const GRAPH = "https://graph.facebook.com";

export interface MetaError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { messaging_product?: string; details?: string };
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  readonly status: number;
  readonly details: MetaError | null;

  constructor(status: number, details: MetaError | null) {
    super(details?.message ?? `Erro da Graph API (HTTP ${status})`);
    this.name = "MetaApiError";
    this.status = status;
    this.details = details;
  }

  /**
   * 131047 = "Message failed to send because more than 24 hours have passed
   * since the customer last replied". É o erro que exige template.
   */
  get isOutsideWindow(): boolean {
    return this.details?.code === 131047;
  }

  /** 130429 / 131048 = throttling. Vale retentar depois. */
  get isRateLimited(): boolean {
    return this.details?.code === 130429 || this.details?.code === 131048;
  }
}

async function graphFetch<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {}
): Promise<T> {
  const { query, ...rest } = init;
  const url = new URL(`${GRAPH}/${serverEnv.meta.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const response = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${serverEnv.meta.accessToken}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    // A Meta corta em 30s de qualquer forma; falhar antes libera o worker.
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new MetaApiError(response.status, json?.error ?? null);
  }
  return json as T;
}

// -----------------------------------------------------------------------------
// Envio de mensagens
// -----------------------------------------------------------------------------

export interface SendResult {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string; message_status?: string }>;
}

function messagesEndpoint(): string {
  return `${serverEnv.meta.phoneNumberId}/messages`;
}

/** Texto livre. Só funciona dentro da janela de 24h. */
export function sendText(
  to: string,
  body: string,
  opts: { previewUrl?: boolean; replyTo?: string } = {}
): Promise<SendResult> {
  return graphFetch<SendResult>(messagesEndpoint(), {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body, preview_url: opts.previewUrl ?? true },
      ...(opts.replyTo ? { context: { message_id: opts.replyTo } } : {}),
    }),
  });
}

export interface TemplateComponent {
  type: "header" | "body" | "button";
  sub_type?: string;
  index?: string;
  parameters: Array<Record<string, unknown>>;
}

/** Template aprovado. É o único caminho fora da janela de 24h. */
export function sendTemplate(
  to: string,
  name: string,
  language: string,
  components: TemplateComponent[] = []
): Promise<SendResult> {
  return graphFetch<SendResult>(messagesEndpoint(), {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(components.length ? { components } : {}),
      },
    }),
  });
}

/**
 * Monta os `components` a partir de uma lista simples de variáveis.
 * O painel manda ["João", "#1234"] e isto vira o formato da Meta.
 */
export function buildTemplateComponents(variables: string[]): TemplateComponent[] {
  if (!variables.length) return [];
  return [
    {
      type: "body",
      parameters: variables.map((text) => ({ type: "text", text })),
    },
  ];
}

export type MediaKind = "image" | "audio" | "video" | "document" | "sticker";

/** Envia mídia por link público ou por media_id já subido na Meta. */
export function sendMedia(
  to: string,
  kind: MediaKind,
  source: { link?: string; id?: string; caption?: string; filename?: string }
): Promise<SendResult> {
  const payload: Record<string, unknown> = {};
  if (source.id) payload.id = source.id;
  else if (source.link) payload.link = source.link;
  else throw new Error("sendMedia exige `link` ou `id`");

  // A Meta rejeita caption em áudio e sticker.
  if (source.caption && kind !== "audio" && kind !== "sticker") {
    payload.caption = source.caption;
  }
  if (source.filename && kind === "document") payload.filename = source.filename;

  return graphFetch<SendResult>(messagesEndpoint(), {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: kind,
      [kind]: payload,
    }),
  });
}

/** Marca como lida — o tique azul no aparelho do contato. */
export async function markAsRead(waMessageId: string): Promise<void> {
  await graphFetch(messagesEndpoint(), {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: waMessageId,
    }),
  });
}

// -----------------------------------------------------------------------------
// Mídia recebida
// -----------------------------------------------------------------------------

/** Resolve o media_id do webhook para uma URL temporária (expira em ~5 min). */
export function getMediaUrl(
  mediaId: string
): Promise<{ url: string; mime_type: string; sha256: string; file_size: number }> {
  return graphFetch(mediaId, { method: "GET" });
}

/** Baixa o binário. A URL da Meta exige o Authorization header. */
export async function downloadMedia(url: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${serverEnv.meta.accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new MetaApiError(response.status, { message: "Falha ao baixar mídia" });
  }
  return {
    buffer: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

// -----------------------------------------------------------------------------
// Templates (HSM)
// -----------------------------------------------------------------------------

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<Record<string, unknown>>;
  quality_score?: { score: string };
  rejected_reason?: string;
}

/** Lista os templates da WABA, seguindo a paginação da Graph API. */
export async function listTemplates(): Promise<MetaTemplate[]> {
  const all: MetaTemplate[] = [];
  let after: string | undefined;

  do {
    const page = await graphFetch<{
      data: MetaTemplate[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>(`${serverEnv.meta.wabaId}/message_templates`, {
      method: "GET",
      query: { limit: "100", ...(after ? { after } : {}) },
    });

    all.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
  } while (after);

  return all;
}

/** Envia um template para aprovação da Meta. Volta com status PENDING. */
export function createTemplate(input: {
  name: string;
  language: string;
  category: string;
  components: Array<Record<string, unknown>>;
}): Promise<{ id: string; status: string; category: string }> {
  return graphFetch(`${serverEnv.meta.wabaId}/message_templates`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteTemplate(name: string): Promise<{ success: boolean }> {
  return graphFetch(`${serverEnv.meta.wabaId}/message_templates`, {
    method: "DELETE",
    query: { name },
  });
}
