/** Tipos compartilhados entre servidor e cliente. */

export type ConversationMode = "bot" | "human";
export type ConversationStatus = "open" | "pending" | "closed";
export type MessageDirection = "in" | "out";
export type MessageAuthor = "contact" | "bot" | "agent" | "system";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

/** Uma linha da view chat.inbox. */
export interface InboxRow {
  conversation_id: string;
  channel_id: string;
  status: ConversationStatus;
  mode: ConversationMode;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  window_expires_at: string | null;
  within_window: boolean;
  bot_resume_at: string | null;
  contact_id: string;
  wa_id: string;
  contact_name: string;
  tags: string[];
  channel_name: string;
  display_phone_number: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  wa_message_id: string | null;
  type: string;
  body: string | null;
  /**
   * A mídia é descrita, não carregada. Os bytes ficam no banco e chegam por
   * /api/messages/:id/media quando a bolha for desenhada — antes o painel
   * baixava o base64 de toda a conversa para exibir um ícone.
   */
  has_media: boolean;
  media_mime: string | null;
  media_filename: string | null;
  media_seconds: number | null;
  status: MessageStatus;
  error: Record<string, unknown> | null;
  author: MessageAuthor;
  agent_id: string | null;
  /** Nome de quem respondeu, quando foi um atendente pelo painel. */
  agent: { full_name: string | null } | null;
  template_id: string | null;
  created_at: string;
}

export interface Template {
  id: string;
  channel_id: string;
  name: string;
  language: string;
  category: string;
  components: Array<Record<string, any>>;
  status: "LOCAL" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
  variable_count: number;
  rejected_reason: string | null;
  quality_rating: string | null;
  updated_at: string;
}

/** Extrai o texto do BODY de um template, para preview no painel. */
export function templateBody(template: Template): string {
  const body = template.components?.find(
    (c) => String(c.type).toUpperCase() === "BODY"
  );
  return body?.text ?? "";
}
