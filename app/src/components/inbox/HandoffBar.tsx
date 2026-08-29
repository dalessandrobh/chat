"use client";

import { useState } from "react";
import type { InboxRow } from "@/lib/types";

/**
 * Controle de quem responde a conversa.
 *
 * É o recurso central do painel: assumir tira o bot do caminho, devolver
 * religa a automação. O estado fica no banco (conversations.mode), então
 * vale para o webhook também, não só para a tela.
 */
export function HandoffBar({
  row,
  onChanged,
}: {
  row: InboxRow;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeMinutes, setResumeMinutes] = useState<string>("");

  async function call(action: "takeover" | "handback") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/conversations/${row.conversation_id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "takeover" && resumeMinutes
              ? { resumeAfterMinutes: Number(resumeMinutes) }
              : {}
          ),
        }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha na operação");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isHuman = row.mode === "human";

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{row.contact_name}</span>
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          +{row.wa_id}
          {row.within_window ? (
            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
              janela aberta
            </span>
          ) : (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              janela fechada — só template
            </span>
          )}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}

        {isHuman && row.bot_resume_at && (
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            volta ao bot{" "}
            {new Date(row.bot_resume_at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}

        {!isHuman && (
          <select
            value={resumeMinutes}
            onChange={(e) => setResumeMinutes(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-xs"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
            title="Devolver ao bot automaticamente depois de…"
          >
            <option value="">sem devolução automática</option>
            <option value="30">devolver em 30min</option>
            <option value="120">devolver em 2h</option>
            <option value="480">devolver em 8h</option>
          </select>
        )}

        <button
          onClick={() => call(isHuman ? "handback" : "takeover")}
          disabled={busy}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-60 ${
            isHuman ? "bg-blue-600 hover:bg-blue-700" : "bg-wa-teal hover:bg-wa-dark"
          }`}
        >
          {busy ? "…" : isHuman ? "Devolver ao bot" : "Assumir conversa"}
        </button>
      </div>
    </div>
  );
}
