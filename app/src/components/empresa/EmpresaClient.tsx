"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Empresa {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

export function EmpresaClient() {
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [equipe, setEquipe] = useState(0);
  const [canais, setCanais] = useState(0);
  const [podeRenomear, setPodeRenomear] = useState(false);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const r = await fetch("/api/companies/atual");
    const j = await r.json();
    if (!r.ok) return setAviso({ kind: "erro", text: j.error });
    setEmpresa(j.empresa);
    setNome(j.empresa.name);
    setEquipe(j.equipe);
    setCanais(j.canais);
    setPodeRenomear(j.podeRenomear);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function salvar() {
    setBusy(true);
    setAviso(null);
    const r = await fetch("/api/companies/atual", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setAviso({ kind: "erro", text: j.error });
    setEmpresa(j.empresa);
    setAviso({ kind: "ok", text: "Nome alterado." });
    // O cabeçalho mostra o nome: sem isto ele ficaria com o antigo até um F5.
    router.refresh();
  }

  if (!empresa) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {aviso?.text ?? "Carregando…"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Empresa</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Os dados desta conta. Cada empresa no painel enxerga só os seus.
      </p>

      <div
        className="mt-6 rounded-lg border p-4"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <label className="text-sm font-medium">Nome</label>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          É o nome que o bot usa ao se apresentar e ao devolver a conversa —
          &ldquo;você está sendo atendido pelo atendimento automatizado da…&rdquo;.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={!podeRenomear}
            className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-60"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          {podeRenomear && (
            <button
              onClick={() => void salvar()}
              disabled={busy || nome.trim().length < 2 || nome === empresa.name}
              className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
          )}
        </div>

        {!podeRenomear && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            Só administradores mudam o nome.
          </p>
        )}

        {aviso && (
          <p
            className={`mt-3 text-sm ${
              aviso.kind === "ok"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {aviso.text}
          </p>
        )}
      </div>

      <dl className="mt-4 grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2"
          style={{ background: "var(--border)", borderColor: "var(--border)" }}>
        {[
          ["Identificador", empresa.slug, "Não muda quando o nome muda. É o que aparece em log e URL."],
          ["No ar desde", new Date(empresa.created_at).toLocaleDateString("pt-BR"), null],
          ["Equipe ativa", `${equipe} ${equipe === 1 ? "pessoa" : "pessoas"}`, null],
          ["Canais", `${canais} ${canais === 1 ? "número" : "números"}`, null],
        ].map(([rotulo, valor, nota]) => (
          <div key={rotulo as string} style={{ background: "var(--panel)" }} className="p-4">
            <dt className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {rotulo}
            </dt>
            <dd className="mt-1 text-sm font-medium">{valor}</dd>
            {nota && (
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {nota}
              </p>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
