"use client";

import type { InboxRow } from "@/lib/types";

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString("pt-BR");
}

/** Etiqueta de quem está no comando da conversa. */
function ModeBadge({ row }: { row: InboxRow }) {
  if (row.mode === "bot") {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
        BOT
      </span>
    );
  }
  // Modo humano sem dono = veio de escalonamento do bot e ninguém pegou ainda.
  if (!row.assigned_agent_id) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        AGUARDANDO
      </span>
    );
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      {row.assigned_agent_name?.split(" ")[0] ?? "HUMANO"}
    </span>
  );
}

export function ConversationList({
  rows,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: {
  rows: InboxRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-r"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="border-b p-3" style={{ borderColor: "var(--border)" }}>
        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Buscar por nome ou número…"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            Nenhuma conversa ainda.
          </p>
        )}

        {rows.map((row) => {
          const active = row.conversation_id === selectedId;
          return (
            <button
              key={row.conversation_id}
              onClick={() => onSelect(row.conversation_id)}
              className={`flex w-full flex-col gap-1 border-b px-3 py-3 text-left transition ${
                active ? "bg-black/[0.04] dark:bg-white/[0.06]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
              }`}
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{row.contact_name}</span>
                <ModeBadge row={row} />
                <span className="ml-auto shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
                  {relativeTime(row.last_message_at)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="truncate text-xs" style={{ color: "var(--muted)" }}>
                  {row.last_message_preview ?? "—"}
                </span>
                {row.unread_count > 0 && (
                  <span className="ml-auto shrink-0 rounded-full bg-wa-green px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {row.unread_count}
                  </span>
                )}
              </div>

              {/* Fora da janela, só template resolve — sinalizamos na lista */}
              {!row.within_window && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">
                  ⏱ janela de 24h expirada
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
