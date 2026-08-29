"use client";

import { useMemo, useState } from "react";
import { templateBody, type Template } from "@/lib/types";

/**
 * Escolha do template e preenchimento das variáveis, com preview do texto
 * final. O envio só libera com todas as variáveis preenchidas — a Meta
 * recusa parâmetro vazio.
 */
export function TemplatePicker({
  templates,
  onCancel,
  onConfirm,
}: {
  templates: Template[];
  onCancel: () => void;
  onConfirm: (template: Template, variables: string[]) => void;
}) {
  const [selected, setSelected] = useState<Template | null>(null);
  const [variables, setVariables] = useState<string[]>([]);

  function choose(template: Template) {
    setSelected(template);
    setVariables(Array(template.variable_count).fill(""));
  }

  const preview = useMemo(() => {
    if (!selected) return "";
    let text = templateBody(selected);
    variables.forEach((value, index) => {
      text = text.replaceAll(`{{${index + 1}}}`, value || `{{${index + 1}}}`);
    });
    return text;
  }, [selected, variables]);

  const ready = selected && variables.every((v) => v.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border p-5 shadow-xl"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Enviar template</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Apenas templates aprovados pela Meta aparecem aqui.
        </p>

        <div className="mt-4 space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => choose(template)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                selected?.id === template.id
                  ? "border-wa-teal bg-wa-teal/5"
                  : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
              }`}
              style={{
                borderColor:
                  selected?.id === template.id ? undefined : "var(--border)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{template.name}</span>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: "var(--bg)", color: "var(--muted)" }}
                >
                  {template.language} · {template.category}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--muted)" }}>
                {templateBody(template)}
              </p>
            </button>
          ))}
        </div>

        {selected && selected.variable_count > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Variáveis</p>
            {variables.map((value, index) => (
              <label key={index} className="block text-xs">
                {`{{${index + 1}}}`}
                <input
                  value={value}
                  onChange={(e) => {
                    const next = [...variables];
                    next[index] = e.target.value;
                    setVariables(next);
                  }}
                  className="mt-0.5 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                />
              </label>
            ))}
          </div>
        )}

        {selected && (
          <div
            className="mt-4 rounded-lg border p-3"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          >
            <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
              Prévia
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{preview}</p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border px-4 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => selected && onConfirm(selected, variables)}
            disabled={!ready}
            className="rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
