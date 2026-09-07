"use client";

import type { InboxRow } from "@/lib/types";
import { esperaEmTexto } from "@/lib/fila";

export type Aba = "aguardando" | "minhas" | "todas";

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
        {/* O tempo vem junto da etiqueta: "aguardando" sem "há quanto tempo"
            não distingue o cliente que chegou agora do que espera há uma hora. */}
        AGUARDANDO {esperaEmTexto(row.aguardando_desde)}
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
  encerradas,
  mostrarEncerradas,
  onMostrarEncerradas,
  aba,
  onAba,
  contagens,
}: {
  rows: InboxRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  encerradas: number;
  mostrarEncerradas: boolean;
  onMostrarEncerradas: (v: boolean) => void;
  aba: Aba;
  onAba: (a: Aba) => void;
  contagens: Record<Aba, number>;
}) {
  const abas: { id: Aba; rotulo: string }[] = [
    { id: "aguardando", rotulo: "Aguardando" },
    { id: "minhas", rotulo: "Minhas" },
    { id: "todas", rotulo: "Todas" },
  ];
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

        <div className="mt-2 flex items-center gap-1">
          {abas.map((t) => (
            <button
              key={t.id}
              onClick={() => onAba(t.id)}
              className={`rounded-lg px-2 py-1 text-xs transition ${
                aba === t.id
                  ? "bg-black/[0.06] font-medium dark:bg-white/[0.10]"
                  : "opacity-70 hover:opacity-100"
              }`}
            >
              {t.rotulo}
              {contagens[t.id] > 0 && (
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    t.id === "aguardando"
                      ? "bg-amber-500 text-white"
                      : "bg-black/[0.08] dark:bg-white/[0.14]"
                  }`}
                >
                  {contagens[t.id]}
                </span>
              )}
            </button>
          ))}

          {/* O arquivo só faz sentido na aba que mostra tudo. */}
          {aba === "todas" && encerradas > 0 && (
            <label
              className="ml-auto flex cursor-pointer items-center gap-1 text-[11px]"
              style={{ color: "var(--muted)" }}
              title={`${encerradas} encerradas`}
            >
              <input
                type="checkbox"
                checked={mostrarEncerradas}
                onChange={(e) => onMostrarEncerradas(e.target.checked)}
              />
              encerradas
            </label>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            {aba === "aguardando"
              ? "Ninguém esperando atendimento."
              : aba === "minhas"
                ? "Você não está atendendo nenhuma conversa."
                : "Nenhuma conversa ainda."}
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
              } ${
                // Quem está esperando fica marcado em qualquer aba: na lista
                // geral é o que impede a conversa da fila de se perder no meio
                // das outras.
                row.aguardando_desde ? "border-l-2" : ""
              }`}
              style={{
                borderColor: "var(--border)",
                // A cor da borda esquerda vem daqui, e não de uma classe: o
                // `borderColor` do style vale para os quatro lados e apagaria
                // qualquer `border-l-amber-500`.
                ...(row.aguardando_desde ? { borderLeftColor: "#f59e0b" } : {}),
              }}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{row.contact_name}</span>
                {row.status === "closed" ? (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    Encerrada
                  </span>
                ) : (
                  <ModeBadge row={row} />
                )}
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
