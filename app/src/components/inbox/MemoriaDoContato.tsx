"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ContactMemory } from "@/lib/types";

/**
 * O que se sabe da pessoa, entre uma conversa e outra.
 *
 * O agente grava sozinho o que ela conta de si; esta tela existe para que isso
 * não seja um depósito cego. Três coisas dependem dela:
 *
 *   - **conferir** — o modelo entende errado, e a frase errada ia entrar em
 *     todo prompt futuro sem ninguém ver;
 *   - **apagar um item** — quem pede para ser esquecido de uma coisa não está
 *     pedindo para sumir inteiro, e é por isso que a unidade é a linha;
 *   - **anotar à mão** — o que um atendente escreve vale mais que o que o robô
 *     apurou, e o banco não poda isso.
 *
 * Fica recolhida por padrão. A conversa é o trabalho; a memória é consulta.
 */
export function MemoriaDoContato({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const [itens, setItens] = useState<ContactMemory[]>([]);
  const [aberta, setAberta] = useState(false);
  const [novo, setNovo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const supabase = supabaseBrowser();

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("contact_memory")
      .select("id, fato, origem, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[memória] não consegui carregar:", error.message);
      return;
    }
    setItens((data ?? []) as ContactMemory[]);
  }, [supabase, contactId]);

  // Recolhe ao trocar de conversa: o que estava aberto era sobre outra pessoa.
  useEffect(() => {
    setAberta(false);
    setNovo("");
    setErro(null);
    void carregar();
  }, [carregar]);

  async function anotar() {
    const fato = novo.replace(/\s+/g, " ").trim();
    if (fato.length < 3) return;

    setBusy(true);
    setErro(null);

    // `company_id` vem do default do banco, que lê quem está logado; a
    // política de escrita confere de novo, e a chave composta garante que o
    // contato é da mesma empresa.
    const { error } = await supabase
      .from("contact_memory")
      .insert({ contact_id: contactId, fato, origem: "agente" });

    setBusy(false);

    if (error) {
      // 23505 é o índice que impede a mesma frase duas vezes. Não é falha de
      // quem digitou: já está anotado, e dizer isso é mais útil que um erro.
      setErro(error.code === "23505" ? "Isso já está anotado." : error.message);
      return;
    }

    setNovo("");
    void carregar();
  }

  async function apagar(id: string) {
    const { error } = await supabase.from("contact_memory").delete().eq("id", id);
    if (error) {
      setErro(error.message);
      return;
    }
    void carregar();
  }

  return (
    <div className="border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
      <button
        onClick={() => setAberta((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-xs"
        style={{ color: "var(--muted)" }}
      >
        <span aria-hidden>{aberta ? "▾" : "▸"}</span>
        <span className="font-medium">Sobre {primeiroNome(contactName)}</span>
        <span>
          {itens.length === 0
            ? "· nada anotado ainda"
            : `· ${itens.length} ${itens.length === 1 ? "anotação" : "anotações"}`}
        </span>
      </button>

      {aberta && (
        <div className="mt-2 space-y-1">
          {itens.map((m) => (
            <div key={m.id} className="group flex items-start gap-2 text-xs">
              <span className="flex-1" style={{ color: "var(--text)" }}>
                {m.fato}{" "}
                <span style={{ color: "var(--muted)" }}>
                  ({fazQuantoTempo(m.created_at)}
                  {m.origem === "agente" ? ", pela equipe" : ""})
                </span>
              </span>
              <button
                onClick={() => void apagar(m.id)}
                title="Apagar esta anotação"
                className="opacity-0 transition group-hover:opacity-100"
                style={{ color: "var(--muted)" }}
              >
                ×
              </button>
            </div>
          ))}

          <div className="flex gap-2 pt-1">
            <input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void anotar();
              }}
              maxLength={300}
              placeholder="Anotar algo sobre esta pessoa"
              className="flex-1 rounded-lg border px-2 py-1 text-xs"
              style={{ borderColor: "var(--border)", background: "transparent" }}
            />
            <button
              onClick={() => void anotar()}
              disabled={busy || novo.trim().length < 3}
              className="rounded-lg border px-3 py-1 text-xs font-medium transition hover:bg-black/[0.03] disabled:opacity-40 dark:hover:bg-white/[0.05]"
              style={{ borderColor: "var(--border)" }}
            >
              Anotar
            </button>
          </div>

          {erro && <p className="text-xs text-red-600">{erro}</p>}

          <p className="pt-1 text-xs" style={{ color: "var(--muted)" }}>
            Vai para o prompt do bot em toda conversa com esta pessoa. Preço,
            prazo e condição não entram aqui — isso é da Base.
          </p>
        </div>
      )}
    </div>
  );
}

/** "Mary Queiroz" vira "Mary": o título da seção é uma frase, não um cadastro. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || "esta pessoa";
}

/**
 * A mesma escala do `chat.faz_quanto_tempo` que monta o prompt. Duplicada de
 * propósito: aqui é para os olhos de quem atende, lá é para o modelo, e juntar
 * as duas faria uma ida ao banco por linha na tela.
 */
function fazQuantoTempo(iso: string): string {
  const dias = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (dias < 1) return "hoje";
  if (dias < 2) return "ontem";
  if (dias < 31) return `há ${Math.floor(dias)} dias`;
  if (dias < 365) {
    const meses = Math.max(1, Math.floor(dias / 30));
    return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  }
  const anos = Math.max(1, Math.floor(dias / 365));
  return `há ${anos} ${anos === 1 ? "ano" : "anos"}`;
}
