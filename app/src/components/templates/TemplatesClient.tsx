"use client";

import { useMemo, useState } from "react";
import { templateBody, type Template } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  LOCAL: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PAUSED: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  DISABLED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export function TemplatesClient({
  initial,
  channelId,
  canEdit,
}: {
  initial: Template[];
  channelId: string | null;
  canEdit: boolean;
}) {
  const [templates, setTemplates] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);

  async function refresh() {
    const response = await fetch("/api/templates");
    const json = await response.json();
    if (response.ok) setTemplates(json.templates);
  }

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/templates/sync", { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setMessage({
        kind: "ok",
        text: `${json.sincronizados} template(s) sincronizado(s) com a Meta.`,
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Mensagens aprovadas pela Meta — o único jeito de falar fora da janela de 24h.
        </p>

        <div className="ml-auto flex gap-2">
          <button
            onClick={sync}
            disabled={busy}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            {busy ? "Sincronizando…" : "Sincronizar com a Meta"}
          </button>
          {canEdit && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
            >
              {creating ? "Fechar" : "Novo template"}
            </button>
          )}
        </div>
      </div>

      {message && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
              : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-200"
          }`}
        >
          {message.text}
        </p>
      )}

      {creating && channelId && (
        <CreateForm
          channelId={channelId}
          onDone={async (result) => {
            setMessage(result);
            if (result.kind === "ok") {
              setCreating(false);
              await refresh();
            }
          }}
        />
      )}

      <div className="mt-6 space-y-2">
        {templates.length === 0 && (
          <p className="rounded-lg border p-6 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            Nenhum template ainda. Clique em “Sincronizar com a Meta” para
            importar os que já existem na sua WABA.
          </p>
        )}

        {templates.map((template) => (
          <div
            key={template.id}
            className="rounded-lg border p-4"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{template.name}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[template.status]}`}>
                {template.status}
              </span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {template.language} · {template.category}
                {template.variable_count > 0 && ` · ${template.variable_count} variável(is)`}
              </span>
            </div>

            <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: "var(--muted)" }}>
              {templateBody(template)}
            </p>

            {template.rejected_reason && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                Motivo da recusa: {template.rejected_reason}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function CreateForm({
  channelId,
  onDone,
}: {
  channelId: string;
  onDone: (result: { kind: "ok" | "erro"; text: string }) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [language, setLanguage] = useState("pt_BR");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // A Meta exige um exemplo por variável; contamos aqui para pedir na hora.
  const variableCount = useMemo(() => {
    const found = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    return found.length ? Math.max(...found) : 0;
  }, [body]);

  const filledExamples = useMemo(
    () => Array.from({ length: variableCount }, (_, i) => examples[i] ?? ""),
    [variableCount, examples]
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    const components: Array<Record<string, unknown>> = [{ type: "BODY", text: body }];
    if (footer.trim()) components.push({ type: "FOOTER", text: footer.trim() });

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          name,
          language,
          category,
          components,
          bodyExamples: filledExamples,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      onDone({
        kind: "ok",
        text: `Template "${name}" enviado para aprovação. A Meta costuma responder em minutos.`,
      });
    } catch (err) {
      onDone({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const invalidName = name.length > 0 && !/^[a-z0-9_]+$/.test(name);

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-lg border p-4"
      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Nome
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
            placeholder="confirmacao_pedido"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          {invalidName && (
            <span className="text-[11px] text-red-600">
              Só minúsculas, números e underscore.
            </span>
          )}
        </label>

        <label className="text-sm">
          Categoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          >
            <option value="UTILITY">UTILITY — transacional</option>
            <option value="MARKETING">MARKETING — promocional</option>
            <option value="AUTHENTICATION">AUTHENTICATION — código</option>
          </select>
        </label>

        <label className="text-sm">
          Idioma
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        Corpo
        <textarea
          required
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Olá {{1}}, seu pedido {{2}} foi confirmado."
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          Use {"{{1}}"}, {"{{2}}"}… para variáveis.
        </span>
      </label>

      <label className="mt-3 block text-sm">
        Rodapé (opcional)
        <input
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          maxLength={60}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
      </label>

      {variableCount > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium">Exemplos das variáveis</p>
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            Obrigatório: a Meta reprova template com variável sem exemplo.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {filledExamples.map((value, index) => (
              <label key={index} className="text-xs">
                {`{{${index + 1}}}`}
                <input
                  required
                  value={value}
                  onChange={(e) => {
                    const next = [...filledExamples];
                    next[index] = e.target.value;
                    setExamples(next);
                  }}
                  className="mt-0.5 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || invalidName}
        className="mt-4 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Enviando…" : "Enviar para aprovação"}
      </button>
    </form>
  );
}
