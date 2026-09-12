"use client";

import { useState } from "react";
import type { InboxRow, Template } from "@/lib/types";
import { templateBody } from "@/lib/types";
import { TemplatePicker } from "./TemplatePicker";

/**
 * Caixa de envio.
 *
 * Bloqueios deliberados, para o agente não descobrir o problema só depois de
 * a Meta recusar — ou, pior, só depois de o cliente receber duas respostas:
 *   - conversa que não é sua: texto desabilitado, com o nome de quem atende;
 *   - conversa em modo bot ou ainda sem dono: texto desabilitado, com atalho
 *     para assumir;
 *   - fora da janela de 24h: texto desabilitado, só template libera.
 *
 * O servidor recusa as mesmas coisas. Aqui é só para a recusa chegar antes do
 * clique, e não depois.
 */
export function Composer({
  row,
  agenteId,
  templates,
  onSent,
}: {
  row: InboxRow;
  agenteId: string | null;
  templates: Template[];
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const souDono = !!agenteId && row.assigned_agent_id === agenteId;
  const isBot = row.mode === "bot";
  const semDono = !isBot && !row.assigned_agent_id;
  const deOutro = !isBot && !!row.assigned_agent_id && !souDono;
  const donoNome = row.assigned_agent_name?.split(" ")[0] ?? "Outro atendente";
  const blocked = !souDono || !row.within_window;

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
      // A faixa do gesto de voltar do iPhone fica por cima do rodapé da
      // página: sem a folga do `safe-area` o botão de enviar cai debaixo dela.
      className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {isBot && (
        <p className="mb-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
          A automação está respondendo esta conversa. Clique em{" "}
          <strong>Assumir conversa</strong> para responder você mesmo.
        </p>
      )}

      {semDono && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          O cliente está esperando um atendente e ninguém assumiu ainda. Clique
          em <strong>Assumir conversa</strong> para responder.
        </p>
      )}

      {deOutro && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          <strong>{donoNome}</strong> está atendendo esta conversa. Para
          responder você mesmo, use <strong>Assumir mesmo assim</strong> — o
          cliente é avisado da troca.
        </p>
      )}

      {souDono && !row.within_window && (
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
          disabled={!souDono || approved.length === 0}
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
            deOutro
              ? `${donoNome} está atendendo esta conversa…`
              : !souDono
                ? "Assuma a conversa para responder…"
                : !row.within_window
                  ? "Janela fechada — envie um template"
                  : "Escreva uma mensagem…"
          }
          // 16px no celular: com fonte menor o iOS dá zoom ao focar e a
          // conversa some da tela na hora de escrever.
          className="max-h-32 flex-1 resize-none rounded-lg border px-3 py-2 text-base outline-none disabled:opacity-60 md:text-sm"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />

        <button
          onClick={sendText}
          disabled={blocked || sending || !text.trim()}
          className="rounded-lg bg-wa-green px-3 py-2 text-sm font-medium text-white transition hover:bg-wa-teal disabled:opacity-40 md:px-4"
        >
          {/* No celular o rótulo vira ícone: os 70px de "Enviar" saem da
              largura de quem está escrevendo. */}
          {sending ? (
            "…"
          ) : (
            <>
              <span className="md:hidden">➤</span>
              <span className="hidden md:inline">Enviar</span>
            </>
          )}
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
