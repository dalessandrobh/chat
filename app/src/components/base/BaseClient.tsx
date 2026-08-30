"use client";

import { useCallback, useEffect, useState } from "react";

interface Section {
  id: string;
  title: string;
  content: string;
  position: number;
  is_active: boolean;
  updated_at: string;
}

/** Acima disto a base começa a pesar no custo de cada mensagem. */
const LIMITE_CONFORTAVEL = 12000;

export function BaseClient() {
  const [sections, setSections] = useState<Section[]>([]);
  const [rendered, setRendered] = useState("");
  const [chars, setChars] = useState(0);
  const [loading, setLoading] = useState(true);
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [vendoPrompt, setVendoPrompt] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/knowledge");
    const j = await r.json();
    if (r.ok) {
      setSections(j.sections);
      setRendered(j.rendered);
      setChars(j.chars);
    } else {
      setAviso({ kind: "erro", text: j.error });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function patch(id: string, body: Record<string, unknown>) {
    setAviso(null);
    const r = await fetch(`/api/knowledge/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      setAviso({ kind: "erro", text: j.error });
      return false;
    }
    await refresh();
    return true;
  }

  async function remove(section: Section) {
    if (!confirm(`Apagar a seção "${section.title}"?`)) return;
    const r = await fetch(`/api/knowledge/${section.id}`, { method: "DELETE" });
    if (!r.ok) {
      setAviso({ kind: "erro", text: (await r.json()).error });
      return;
    }
    await refresh();
  }

  const ativas = sections.filter((s) => s.is_active).length;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Base de conhecimento</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          O que o agente sabe sobre o negócio.
        </p>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setVendoPrompt((v) => !v)}
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            {vendoPrompt ? "Fechar" : "Ver o que o agente recebe"}
          </button>
          <button
            onClick={() => setCriando((v) => !v)}
            className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
          >
            {criando ? "Fechar" : "Nova seção"}
          </button>
        </div>
      </div>

      <Explicacao ativas={ativas} total={sections.length} chars={chars} />

      {aviso && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            aviso.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
              : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-200"
          }`}
        >
          {aviso.text}
        </p>
      )}

      {vendoPrompt && (
        <div
          className="mt-4 rounded-lg border p-4"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <p className="text-sm font-medium">Texto exato entregue ao agente</p>
          <pre
            className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs"
            style={{ background: "var(--bg)", color: "var(--muted)" }}
          >
            {rendered || "(nenhuma seção ligada — o agente trabalha só com as regras do prompt)"}
          </pre>
        </div>
      )}

      {criando && (
        <Formulario
          onDone={async (resultado) => {
            setAviso(resultado);
            if (resultado.kind === "ok") {
              setCriando(false);
              await refresh();
            }
          }}
        />
      )}

      <div className="mt-6 space-y-3">
        {loading && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Carregando…
          </p>
        )}
        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            onPatch={patch}
            onRemove={remove}
          />
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function Explicacao({
  ativas,
  total,
  chars,
}: {
  ativas: number;
  total: number;
  chars: number;
}) {
  const pesado = chars > LIMITE_CONFORTAVEL;

  return (
    <div
      className="mt-4 rounded-lg border p-4 text-sm"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <p>
        Não existe treino: a base inteira é enviada junto de cada mensagem. Você
        edita aqui, salva, e a{" "}
        <strong>próxima resposta já sai diferente</strong> — sem reinício.
      </p>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        {ativas} de {total} seções ligadas · {chars.toLocaleString("pt-BR")}{" "}
        caracteres chegam ao agente
        {pesado && (
          <span className="text-amber-700 dark:text-amber-400">
            {" "}
            — já está grande; acima disso o custo por mensagem sobe de forma
            perceptível.
          </span>
        )}
      </p>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Seção desligada não é lida. Ligue só o que você conferiu que está
        correto: o agente trata o que estiver aqui como verdade.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------

function SectionCard({
  section,
  onPatch,
  onRemove,
}: {
  section: Section;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>;
  onRemove: (s: Section) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [content, setContent] = useState(section.content);
  const [busy, setBusy] = useState(false);

  async function salvar() {
    setBusy(true);
    const ok = await onPatch(section.id, { title, content });
    setBusy(false);
    if (ok) setEditando(false);
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: "var(--panel)",
        borderColor: "var(--border)",
        opacity: section.is_active ? 1 : 0.65,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {editando ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border px-2 py-1 text-sm font-medium outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
        ) : (
          <span className="font-medium">{section.title}</span>
        )}

        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            section.is_active
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {section.is_active ? "No prompt" : "Desligada"}
        </span>

        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {section.content.length} caracteres
        </span>

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void onPatch(section.id, { isActive: !section.is_active })}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border)" }}
          >
            {section.is_active ? "Desligar" : "Ligar"}
          </button>
          <button
            onClick={() => setEditando((v) => !v)}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border)" }}
          >
            {editando ? "Cancelar" : "Editar"}
          </button>
          <button
            onClick={() => onRemove(section)}
            className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900 dark:text-red-400"
          >
            Apagar
          </button>
        </div>
      </div>

      {editando ? (
        <>
          <textarea
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="mt-3 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          <button
            onClick={salvar}
            disabled={busy}
            className="mt-2 rounded-lg bg-wa-green px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </>
      ) : (
        <pre
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs"
          style={{ color: "var(--muted)" }}
        >
          {section.content}
        </pre>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function Formulario({
  onDone,
}: {
  onDone: (r: { kind: "ok" | "erro"; text: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onDone({
        kind: "ok",
        text: `Seção "${title}" criada, desligada. Confira o texto e ligue quando estiver certo.`,
      });
    } catch (err) {
      onDone({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-lg border p-4"
      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
    >
      <label className="block text-sm">
        Título
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Formas de pagamento"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
      </label>
      <label className="mt-3 block text-sm">
        Conteúdo
        <textarea
          required
          rows={8}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={"Escreva como você explicaria a um atendente novo.\nFrases curtas, sem enrolação."}
          className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Criando…" : "Criar seção"}
      </button>
    </form>
  );
}
