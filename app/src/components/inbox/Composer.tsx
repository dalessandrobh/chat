"use client";

import { useState } from "react";
import type { InboxRow, Template } from "@/lib/types";
import { templateBody } from "@/lib/types";
import { TemplatePicker } from "./TemplatePicker";

/**
 * Caixa de envio.
 *
 * Dois bloqueios deliberados, para o agente não descobrir o problema só
 * depois da Meta recusar:
 *   - conversa em modo bot: texto desabilitado, com atalho para assumir;
 *   - fora da janela de 24h: texto desabilitado, só template libera.
 */
export function Composer({
  row,
  templates,
  onSent,
}: {
  row: InboxRow;
  templates: Template[];
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isBot = row.mode === "bot";
  const blocked = isBot || !row.within_window;

  async function post(body: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha ao enviar");
      setText("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function sendText() {
    if (!text.trim()) return;
    void post({ type: "text", conversationId: row.conversation_id, text: text.trim() });
  }

  function sendTemplate(template: Template, variables: string[]) {
    setPickerOpen(false);
    void post({
      type: "template",
      conversationId: row.conversation_id,
      templateId: template.id,
      variables,
    });
  }

  const approved = templates.filter((t) => t.status === "APPROVED");

  return (
    <div
      className="border-t p-3"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {isBot && (
        <p className="mb-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
          A automação está respondendo esta conversa. Clique em{" "}
          <strong>Assumir conversa</strong> para responder você mesmo.
        </p>
      )}

      {!isBot && !row.within_window && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          Passaram-se mais de 24h desde a última mensagem do contato. Só um
          template aprovado reabre a conversa.
        </p>
      )}

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => setPickerOpen(true)}
          disabled={isBot || approved.length === 0}
          title={
            approved.length === 0
              ? "Nenhum template aprovado. Cadastre em Templates."
              : "Enviar template aprovado"
          }
          className="rounded-lg border px-3 py-2 text-sm transition hover:bg-black/[0.03] disabled:opacity-40 dark:hover:bg-white/[0.05]"
          style={{ borderColor: "var(--border)" }}
        >
          📋
        </button>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendText();
            }
          }}
          disabled={blocked || sending}
          rows={1}
          placeholder={
            isBot
              ? "Assuma a conversa para responder…"
              : !row.within_window
                ? "Janela fechada — envie um template"
                : "Escreva uma mensagem…"
          }
          className="max-h-32 flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />

        <button
          onClick={sendText}
          disabled={blocked || sending || !text.trim()}
          className="rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white transition hover:bg-wa-teal disabled:opacity-40"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>

      {pickerOpen && (
        <TemplatePicker
          templates={approved}
          onCancel={() => setPickerOpen(false)}
          onConfirm={sendTemplate}
        />
      )}
    </div>
  );
}

export { templateBody };
