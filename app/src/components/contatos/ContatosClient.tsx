"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodificar, lerPlanilha, MODELO_CSV, type Leitura } from "@/lib/planilha";

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
          {importando ? "Fechar" : "Importar planilha"}
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

/** A API aceita 5000 por requisição; planilha grande vai em pedaços. */
const LOTE = 2000;

function Importador({ onDone }: { onDone: (r: { kind: "ok" | "erro"; text: string }) => void }) {
  const [texto, setTexto] = useState("");
  const [tags, setTags] = useState("");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

  // Reler a cada tecla é barato e evita o pior fluxo possível: importar,
  // descobrir que a coluna errada foi lida, e ter que desfazer no banco.
  function reler(novoTexto: string, novasTags = tagList) {
    setLeitura(novoTexto.trim() ? lerPlanilha(novoTexto, novasTags) : null);
  }

  async function abrir(file: File) {
    const bruto = decodificar(await file.arrayBuffer());
    setArquivo(file.name);
    setTexto(bruto);
    reler(bruto);
  }

  function baixarModelo() {
    // BOM na frente: sem ele o Excel abre o CSV como ASCII e come os acentos.
    const blob = new Blob(["\ufeff" + MODELO_CSV], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo-contatos.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importar() {
    if (!leitura?.contatos.length) return;
    setBusy(true);

    try {
      let inseridos = 0;
      let ignorados = 0;

      for (let i = 0; i < leitura.contatos.length; i += LOTE) {
        const lote = leitura.contatos.slice(i, i + LOTE);
        const r = await fetch("/api/audience", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contatos: lote.map((c) => ({ name: c.nome, waId: c.waId, tags: c.tags })),
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        inseridos += j.inseridos;
        ignorados += j.ignorados;
      }

      const partes = [`${inseridos} contatos importados`];
      if (ignorados) partes.push(`${ignorados} já estavam na base e ficaram como estavam`);
      if (leitura.repetidas) partes.push(`${leitura.repetidas} repetidos na planilha`);
      if (leitura.rejeitadas.length) partes.push(`${leitura.rejeitadas.length} linhas sem nome ou número válido`);
      onDone({ kind: "ok", text: partes.join(", ") + "." });
    } catch (err) {
      onDone({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const avisos = leitura?.contatos.filter((c) => c.aviso) ?? [];

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => inputArquivo.current?.click()}
          className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
        >
          Escolher planilha
        </button>
        <input
          ref={inputArquivo}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void abrir(f);
          }}
        />
        {arquivo && <span className="text-sm">{arquivo}</span>}
        <button onClick={baixarModelo} className="ml-auto text-xs underline" style={{ color: "var(--muted)" }}>
          Baixar modelo
        </button>
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Salve a planilha como <strong>CSV</strong> (no Excel: Arquivo → Salvar
        como → CSV; no Google Planilhas: Fazer download → CSV). Colunas
        reconhecidas pelo título: nome, telefone/celular/whatsapp e
        etiquetas — em qualquer ordem. Sem título, lê nas três primeiras
        colunas nessa ordem. O número pode vir com parênteses, traços e espaços,
        e o DDI 55 é acrescentado quando falta.
      </p>

      <textarea
        rows={5}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setArquivo(null); reler(e.target.value); }}
        placeholder={"Ou cole aqui:\nMaria Silva; (31) 99999-8888\nJoão Souza; 31 98888-7777"}
        className="mt-3 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      <input
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
          reler(texto, e.target.value.split(",").map((t) => t.trim()).filter(Boolean));
        }}
        placeholder="Etiquetas para todos desta importação (ex.: clientes-2025, bh)"
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      {leitura && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            {leitura.contatos.length} contatos prontos
            {leitura.temCabecalho ? " (primeira linha lida como título das colunas)" : ""}
          </p>

          {leitura.contatos.length > 0 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-left text-xs">
                <tbody>
                  {leitura.contatos.slice(0, 100).map((c) => (
                    <tr key={c.waId} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-1">{c.nome}</td>
                      <td className="px-2 py-1 font-mono">{c.waId}</td>
                      <td className="px-2 py-1" style={{ color: "var(--muted)" }}>{c.tags.join(", ")}</td>
                      <td className="px-2 py-1 text-amber-700 dark:text-amber-400">{c.aviso ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leitura.contatos.length > 100 && (
                <p className="px-2 py-1 text-xs" style={{ color: "var(--muted)" }}>
                  … e mais {leitura.contatos.length - 100}.
                </p>
              )}
            </div>
          )}

          {avisos.length > 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {avisos.length} número(s) com ressalva. Eles entram assim mesmo — o
              envio confirma na hora se têm WhatsApp.
            </p>
          )}

          {leitura.rejeitadas.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-600 dark:text-red-400">
                {leitura.rejeitadas.length} linha(s) fora
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs" style={{ color: "var(--muted)" }}>
                {leitura.rejeitadas.slice(0, 30).map((r) => (
                  <li key={r.linha}>
                    linha {r.linha}: {r.motivo} — <span className="font-mono">{r.conteudo}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Quem já está na base não é sobrescrito: reimportar a planilha inteira
        não devolve à lista quem pediu para sair.
      </p>

      <button
        onClick={importar}
        disabled={busy || !leitura?.contatos.length}
        className="mt-3 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Importando…" : `Importar ${leitura?.contatos.length ?? 0} contatos`}
      </button>
    </div>
  );
}
