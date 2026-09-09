"use client";

import { useCallback, useEffect, useState } from "react";

interface Bloqueio {
  id: string;
  wa_id: string;
  chave: string;
  reason: string | null;
  created_at: string;
  agente: { full_name: string | null } | null;
}

/** "553196546236" → "+55 (31) 9654-6236", quando dá para separar. */
function bonito(chave: string): string {
  const m = chave.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${chave}`;
}

export function BloqueiosClient() {
  const [bloqueios, setBloqueios] = useState<Bloqueio[] | null>(null);
  const [numero, setNumero] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/blocks");
    const json = await r.json();
    if (!r.ok) {
      setErro(json.error ?? "Não consegui carregar a lista");
      return;
    }
    setBloqueios(json.bloqueios as Bloqueio[]);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function bloquear() {
    if (!numero.trim()) return;
    setOcupado(true);
    setErro(null);
    const r = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waId: numero.trim(), reason: motivo.trim() || undefined }),
    });
    if (!r.ok) setErro((await r.json()).error ?? "Não consegui bloquear");
    else {
      setNumero("");
      setMotivo("");
    }
    await carregar();
    setOcupado(false);
  }

  async function desbloquear(waId: string) {
    setOcupado(true);
    setErro(null);
    const r = await fetch(`/api/blocks?waId=${encodeURIComponent(waId)}`, { method: "DELETE" });
    if (!r.ok) setErro((await r.json()).error ?? "Não consegui desbloquear");
    await carregar();
    setOcupado(false);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Bloqueios</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Número bloqueado não recebe resposta do bot e some da lista de conversas.
        Nada é apagado: desbloquear devolve o histórico inteiro.
      </p>

      <div
        className="mt-4 rounded-lg border p-4"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <p className="font-medium">Bloquear um número</p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Pode digitar como quiser — com ou sem o 9, com ou sem o código do país.
          O 9 que a operadora acrescentou não faz do celular outro número.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="(31) 99654-6236"
            className="w-48 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="motivo (opcional)"
            className="min-w-48 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          <button
            onClick={bloquear}
            disabled={ocupado || !numero.trim()}
            className="rounded-lg bg-wa-teal px-4 py-2 text-sm font-medium text-white transition hover:bg-wa-dark disabled:opacity-50"
          >
            Bloquear
          </button>
        </div>

        {erro && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
            {erro}
          </p>
        )}
      </div>

      <div
        className="mt-4 rounded-lg border"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        {bloqueios === null && (
          <p className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            Carregando…
          </p>
        )}

        {bloqueios?.length === 0 && (
          <p className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            Nenhum número bloqueado.
          </p>
        )}

        {bloqueios?.map((b) => (
          <div
            key={b.id}
            className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-sm font-medium tabular-nums">{bonito(b.chave)}</span>
            {b.reason && (
              <span className="truncate text-sm" style={{ color: "var(--muted)" }}>
                {b.reason}
              </span>
            )}
            <span className="ml-auto text-[11px]" style={{ color: "var(--muted)" }}>
              {b.agente?.full_name?.split(" ")[0] ?? "alguém"} ·{" "}
              {new Date(b.created_at).toLocaleDateString("pt-BR")}
            </span>
            <button
              onClick={() => void desbloquear(b.chave)}
              disabled={ocupado}
              className="rounded-lg border px-3 py-1 text-xs font-medium transition hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/[0.05]"
              style={{ borderColor: "var(--border)" }}
            >
              Desbloquear
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
