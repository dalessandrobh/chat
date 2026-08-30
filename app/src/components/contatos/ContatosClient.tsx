"use client";

import { useCallback, useEffect, useState } from "react";

interface Contato {
  id: string;
  name: string;
  wa_id: string;
  tags: string[];
  is_sendable: boolean;
  unsendable_reason: string | null;
  unsendable_at: string | null;
}

const MOTIVO: Record<string, string> = {
  opt_out: "Pediu para sair",
  no_whatsapp: "Sem WhatsApp",
  send_failed: "Falhou no envio",
  manual: "Retirado à mão",
};

export function ContatosClient() {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [resumo, setResumo] = useState({ total: 0, enviaveis: 0, fora: 0 });
  const [busca, setBusca] = useState("");
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);
  const [importando, setImportando] = useState(false);

  const refresh = useCallback(async (q = "") => {
    const r = await fetch(`/api/audience${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const j = await r.json();
    if (r.ok) {
      setContatos(j.contatos);
      setResumo(j.resumo);
    } else setAviso({ kind: "erro", text: j.error });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Base de envio</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Quem pode receber campanhas.
        </p>
        <button
          onClick={() => setImportando((v) => !v)}
          className="ml-auto rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
        >
          {importando ? "Fechar" : "Importar contatos"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Cartao rotulo="Na base" valor={resumo.total} />
        <Cartao rotulo="Podem receber" valor={resumo.enviaveis} cor="text-emerald-600 dark:text-emerald-400" />
        <Cartao rotulo="Fora da lista" valor={resumo.fora} cor="text-amber-600 dark:text-amber-400" />
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Ninguém é apagado. Quem pede para sair, falha no envio ou não tem
        WhatsApp fica aqui marcado — é o que impede recadastrar amanhã quem
        pediu para sair hoje.
      </p>

      {aviso && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${
          aviso.kind === "ok"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-200"}`}>
          {aviso.text}
        </p>
      )}

      {importando && (
        <Importador onDone={async (r) => {
          setAviso(r);
          if (r.kind === "ok") { setImportando(false); await refresh(busca); }
        }} />
      )}

      <input
        value={busca}
        onChange={(e) => { setBusca(e.target.value); void refresh(e.target.value); }}
        placeholder="Buscar por nome ou número"
        className="mt-6 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      <div className="mt-4 space-y-1">
        {contatos.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{
              background: "var(--panel)",
              borderColor: "var(--border)",
              opacity: c.is_sendable ? 1 : 0.6,
            }}
          >
            <span className="font-medium">{c.name}</span>
            <span style={{ color: "var(--muted)" }}>{c.wa_id}</span>
            {c.tags.map((t) => (
              <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-800">
                {t}
              </span>
            ))}
            {!c.is_sendable && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {MOTIVO[c.unsendable_reason ?? ""] ?? "Fora da lista"}
              </span>
            )}
          </div>
        ))}
        {contatos.length === 0 && (
          <p className="rounded-lg border p-6 text-center text-sm"
             style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            Nenhum contato ainda.
          </p>
        )}
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--muted)" }}>{rotulo}</p>
      <p className={`text-2xl font-semibold ${cor ?? ""}`}>{valor}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------

function Importador({ onDone }: { onDone: (r: { kind: "ok" | "erro"; text: string }) => void }) {
  const [texto, setTexto] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  async function importar() {
    setBusy(true);
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const contatos: Array<{ name: string; waId: string; tags: string[] }> = [];
    const problemas: string[] = [];

    texto.split(/\r?\n/).forEach((linha, i) => {
      const bruto = linha.trim();
      if (!bruto) return;
      const [nome, numero] = bruto.split(/[;,\t]/).map((p) => p?.trim());
      // Só dígitos: planilha vem cheia de (31) 9 9999-9999.
      const limpo = (numero ?? "").replace(/\D/g, "");
      if (!nome || !limpo) { problemas.push(`linha ${i + 1}`); return; }
      contatos.push({ name: nome, waId: limpo, tags: tagList });
    });

    if (contatos.length === 0) {
      onDone({ kind: "erro", text: "Nenhuma linha válida. Use: Nome; 5531999998888" });
      setBusy(false);
      return;
    }

    try {
      const r = await fetch("/api/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contatos }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onDone({
        kind: "ok",
        text: `${j.inseridos} contatos importados` +
          (j.ignorados ? `, ${j.ignorados} já existiam e foram mantidos como estavam` : "") +
          (problemas.length ? `. Ignorei ${problemas.length} linha(s) sem nome ou número.` : "."),
      });
    } catch (err) {
      onDone({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <p className="text-sm font-medium">Colar da planilha</p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Uma linha por contato: <code>Nome; 5531999998888</code>. Aceita vírgula,
        ponto e vírgula ou tabulação. O número é limpo automaticamente — pode
        colar com parênteses e traços.
      </p>
      <textarea
        rows={8}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={"Maria Silva; (31) 99999-8888\nJoão Souza; 5531988887777"}
        className="mt-3 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Etiquetas, separadas por vírgula (ex.: clientes-2025, bh)"
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Quem já está na base não é sobrescrito: reimportar a planilha inteira
        não devolve à lista quem pediu para sair.
      </p>
      <button
        onClick={importar}
        disabled={busy || !texto.trim()}
        className="mt-3 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Importando…" : "Importar"}
      </button>
    </div>
  );
}
