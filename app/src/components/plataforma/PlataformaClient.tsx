"use client";

import { useCallback, useEffect, useState } from "react";

interface Empresa {
  company_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  agentes: number;
  canais: number;
  canais_ativos: number;
  conversas: number;
  mensagens_30d: number;
  ultima_msg: string | null;
}

interface Registro {
  action: string;
  created_at: string;
  detail: Record<string, unknown>;
  agents: { full_name: string | null } | null;
}

const data = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";

export function PlataformaClient() {
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [log, setLog] = useState<Registro[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/platform");
    const j = await r.json();
    if (r.ok) {
      setEmpresas(j.empresas);
      setLog(j.log);
    } else {
      setErro(j.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-semibold">Plataforma</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Todas as empresas atendidas por esta instalação. Medida, não conteúdo —
        conversa de cliente não se lê por aqui.
      </p>

      {erro && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{erro}</p>}

      {!empresas ? (
        <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
          Carregando…
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                <th className="pb-2 pr-4 font-medium">Empresa</th>
                <th className="pb-2 pr-4 text-right font-medium">Equipe</th>
                <th className="pb-2 pr-4 text-right font-medium">Canais</th>
                <th className="pb-2 pr-4 text-right font-medium">Conversas</th>
                <th className="pb-2 pr-4 text-right font-medium">Msgs 30d</th>
                <th className="pb-2 pr-4 text-right font-medium">Última</th>
                <th className="pb-2 font-medium">Desde</th>
              </tr>
            </thead>
            <tbody className="font-variant-numeric tabular-nums">
              {empresas.map((e) => (
                <tr key={e.company_id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-4">
                    <span className="font-medium">{e.name}</span>
                    {!e.is_active && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        inativa
                      </span>
                    )}
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                      {e.slug}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">{e.agentes}</td>
                  <td className="py-2 pr-4 text-right">
                    {e.canais_ativos}
                    {e.canais !== e.canais_ativos && (
                      <span style={{ color: "var(--muted)" }}> / {e.canais}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">{e.conversas}</td>
                  <td className="py-2 pr-4 text-right">{e.mensagens_30d}</td>
                  <td className="py-2 pr-4 text-right">{data(e.ultima_msg)}</td>
                  <td className="py-2">{data(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 text-sm font-semibold">Quem olhou, e quando</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Abrir esta tela é um acesso à conta de terceiros e fica registrado —
        inclusive o seu de agora.
      </p>
      <ul className="mt-3 space-y-1">
        {log.map((r, i) => (
          <li key={i} className="text-xs" style={{ color: "var(--muted)" }}>
            {new Date(r.created_at).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}{" "}
            · {r.agents?.full_name ?? "—"} · {r.action}
          </li>
        ))}
      </ul>
    </div>
  );
}
