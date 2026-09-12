"use client";

import { useState } from "react";
import type { AgenteResumo, InboxRow } from "@/lib/types";
import { usePresenca } from "@/components/painel/Presenca";

type Acao = "takeover" | "handback" | "release" | "assign";

const ROTULO_FORCADO: Record<Acao, string> = {
  takeover: "Assumir mesmo assim",
  handback: "Devolver mesmo assim",
  release: "Liberar mesmo assim",
  assign: "Direcionar mesmo assim",
};

/**
 * Controle de quem responde a conversa.
 *
 * É o recurso central do painel: assumir tira o bot do caminho, devolver
 * religa a automação. O estado fica no banco (conversations.mode), então
 * vale para o webhook também, não só para a tela.
 *
 * Assumir é exclusivo. Quando a conversa já tem outro dono o servidor recusa
 * com 409, e a barra troca o botão por "Assumir mesmo assim", que pede um
 * motivo antes de tomar. O mesmo vale para devolver ao bot e para liberar:
 * mexer no atendimento de outra pessoa é mais forte do que responder por cima
 * dela.
 *
 * Liberar e devolver não são a mesma coisa, e é por isso que são dois botões.
 * Devolver religa a automação e despede o cliente; liberar solta a conversa de
 * volta para a fila, calada, porque quem pediu uma pessoa continua querendo
 * uma.
 */
export function HandoffBar({
  row,
  agenteId,
  agentes,
  onChanged,
  onVoltar,
}: {
  row: InboxRow;
  agenteId: string | null;
  agentes: AgenteResumo[];
  onChanged: () => void;
  /** Volta para a fila no celular, onde a conversa ocupa a tela inteira. */
  onVoltar: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeMinutes, setResumeMinutes] = useState<string>("");
  /** Ação que o servidor recusou por conflito, aguardando motivo. */
  const [forcar, setForcar] = useState<Acao | null>(null);
  const [motivo, setMotivo] = useState("");
  /** Guardado à parte porque o "mesmo assim" precisa repetir a escolha. */
  const [paraQuem, setParaQuem] = useState<string | null>(null);
  /** Bloquear some com a conversa da tela: vale confirmar antes. */
  const [confirmandoBloqueio, setConfirmandoBloqueio] = useState(false);
  const [motivoBloqueio, setMotivoBloqueio] = useState("");
  /**
   * No celular a barra não tem largura para oito controles: fica o botão que
   * decide quem responde, e o resto sai atrás do "⋯". No tablet e no PC tudo
   * aparece de uma vez, como sempre.
   */
  const [maisAberto, setMaisAberto] = useState(false);

  const online = usePresenca();

  const isHuman = row.mode === "human";
  const encerrada = row.status === "closed";
  const souDono = !!agenteId && row.assigned_agent_id === agenteId;
  const deOutro = isHuman && !!row.assigned_agent_id && !souDono;
  const donoNome = row.assigned_agent_name?.split(" ")[0] ?? "outro atendente";

  /**
   * `alvo` vem por parâmetro, e não do estado: o select dispara a chamada no
   * mesmo evento em que muda a escolha, e o estado do React só chegaria na
   * próxima renderização. Quem força depois reaproveita o que ficou guardado.
   */
  async function call(action: Acao, force = false, alvo: string | null = paraQuem) {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (action === "takeover" && resumeMinutes) {
        body.resumeAfterMinutes = Number(resumeMinutes);
      }
      if (action === "assign") {
        body.agentId = alvo;
      }
      if (force) {
        body.force = true;
        body.reason = motivo.trim();
      }

      const response = await fetch(
        `/api/conversations/${row.conversation_id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const json = await response.json();
      if (!response.ok) {
        // Conflito não é falha de quem clicou: é outra pessoa na frente. A
        // barra oferece o caminho em vez de só mostrar o erro.
        if (response.status === 409) setForcar(action);
        throw new Error(json.error ?? "Falha na operação");
      }
      setForcar(null);
      setMotivo("");
      setParaQuem(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function bloquear() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waId: row.wa_id,
          reason: motivoBloqueio.trim() || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha ao bloquear");
      setConfirmandoBloqueio(false);
      setMotivoBloqueio("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reativarBot() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${row.conversation_id}/reactivate`, {
        method: "POST",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha na operação");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Encerrar e reabrir usam outro método na mesma rota. */
  async function encerrarOuReabrir() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${row.conversation_id}/close`, {
        method: encerrada ? "DELETE" : "POST",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha na operação");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** O que só aparece no celular depois do "⋯". */
  const secundario = maisAberto ? "" : "hidden md:block";

  return (
    <div
      className="flex flex-col gap-2 border-b px-3 py-2.5 md:px-4"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <button
          onClick={onVoltar}
          aria-label="Voltar para a lista de conversas"
          className="-ml-1 rounded-lg px-2 py-1 text-lg leading-none transition hover:bg-black/[0.04] md:hidden dark:hover:bg-white/[0.06]"
        >
          ←
        </button>

        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{row.contact_name}</span>
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            +{row.wa_id}
            {row.within_window ? (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                janela aberta
              </span>
            ) : (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                janela fechada — só template
              </span>
            )}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {error && <span className="text-xs text-red-600">{error}</span>}

          <button
            onClick={() => setMaisAberto((v) => !v)}
            aria-expanded={maisAberto}
            aria-label="Mais ações desta conversa"
            className="rounded-lg border px-2 py-1.5 text-xs leading-none md:hidden"
            style={{ borderColor: "var(--border)" }}
          >
            ⋯
          </button>

          {deOutro && (
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              atendida por {donoNome}
            </span>
          )}

          {/* Direcionar só faz sentido em atendimento humano: uma conversa com
              a automação não está em fila nenhuma. O ponto verde é presença —
              sinal fraco, que informa e não decide. */}
          {isHuman && (
            <select
              value={row.atribuida_para ?? ""}
              onChange={(e) => {
                const alvo = e.target.value || null;
                setParaQuem(alvo);
                void call("assign", false, alvo);
              }}
              disabled={busy}
              title="Direcionar a um atendente. A conversa continua na fila."
              className={`max-w-40 rounded-lg border px-2 py-1.5 text-xs ${secundario}`}
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}
            >
              <option value="">sem direcionamento</option>
              {agentes.map((a) => (
                <option key={a.id} value={a.id}>
                  {online.has(a.id) ? "● " : "○ "}
                  {a.full_name?.split(" ")[0] ?? "sem nome"}
                  {a.id === agenteId ? " (você)" : ""}
                </option>
              ))}
            </select>
          )}

          {souDono && row.bot_resume_at && (
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              volta ao bot{" "}
              {new Date(row.bot_resume_at).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}

          {/* A devolução programada vale para qualquer assunção, não só a que
              tira a conversa do bot: quem pega uma da fila também pode querer
              soltar em meia hora. */}
          {!souDono && (
            <select
              value={resumeMinutes}
              onChange={(e) => setResumeMinutes(e.target.value)}
              className={`rounded-lg border px-2 py-1.5 text-xs ${secundario}`}
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}
              title="Devolver ao bot automaticamente depois de…"
            >
              <option value="">sem devolução automática</option>
              <option value="30">devolver em 30min</option>
              <option value="120">devolver em 2h</option>
              <option value="480">devolver em 8h</option>
            </select>
          )}

          {/* Só quem está com a conversa solta de volta na fila. Para os
              outros o caminho é assumir — e o servidor recusa igual. */}
          {isHuman && (souDono || deOutro) && (
            <button
              onClick={() => call("release")}
              disabled={busy}
              title="Solta a conversa de volta para a fila, sem avisar o cliente"
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03] disabled:opacity-60 dark:hover:bg-white/[0.05] ${secundario}`}
              style={{ borderColor: "var(--border)" }}
            >
              Liberar
            </button>
          )}

          <button
            onClick={() => call(souDono ? "handback" : "takeover")}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-60 ${
              souDono ? "bg-blue-600 hover:bg-blue-700" : "bg-wa-teal hover:bg-wa-dark"
            }`}
          >
            {busy ? "…" : souDono ? "Devolver ao bot" : "Assumir conversa"}
          </button>

          <button
            onClick={() => setConfirmandoBloqueio((v) => !v)}
            disabled={busy}
            title="Bloquear este número: some da lista e o bot não responde mais"
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03] disabled:opacity-60 dark:hover:bg-white/[0.05] ${secundario}`}
            style={{ borderColor: "var(--border)" }}
          >
            Bloquear
          </button>

          {/* Encerrar é arquivar: não fala com o cliente, e a conversa reabre
              sozinha se ele voltar a escrever. Por isso não pede posse — quem
              organiza a lista não está tomando o atendimento de ninguém. */}
          <button
            onClick={encerrarOuReabrir}
            disabled={busy}
            title={
              encerrada
                ? "Traz a conversa de volta para a lista"
                : "Arquiva a conversa. Não avisa o cliente, e ela volta sozinha se ele escrever."
            }
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:bg-black/[0.03] disabled:opacity-60 dark:hover:bg-white/[0.05] ${secundario}`}
            style={{ borderColor: "var(--border)" }}
          >
            {encerrada ? "Reabrir" : "Encerrar"}
          </button>
        </div>
      </div>

      {confirmandoBloqueio && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/60">
          <span className="text-xs text-red-900 dark:text-red-200">
            Bloquear +{row.wa_id}? Some da lista e o bot não responde mais. Nada
            é apagado — dá para desbloquear em Bloqueios.
          </span>
          <input
            value={motivoBloqueio}
            onChange={(e) => setMotivoBloqueio(e.target.value)}
            placeholder="motivo (opcional)"
            className="min-w-40 flex-1 rounded-lg border px-2 py-1 text-base outline-none md:text-xs"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          <button
            onClick={bloquear}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            Bloquear
          </button>
          <button
            onClick={() => setConfirmandoBloqueio(false)}
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            cancelar
          </button>
        </div>
      )}

      {row.silenciada_em && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            🤖 O bot parou de responder aqui. {row.silenciada_motivo}
          </span>
          <button
            onClick={reativarBot}
            disabled={busy}
            title="Volta a deixar o bot responder nesta conversa"
            className="ml-auto rounded-lg border px-3 py-1 text-xs font-medium transition hover:bg-black/[0.03] disabled:opacity-60 dark:hover:bg-white/[0.05]"
            style={{ borderColor: "var(--border)" }}
          >
            Reativar o bot
          </button>
        </div>
      )}

      {forcar && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/60">
          <span className="text-xs text-amber-900 dark:text-amber-200">
            {forcar === "takeover"
              ? `Tomar a conversa de ${donoNome}:`
              : forcar === "release"
                ? `Devolver à fila a conversa de ${donoNome}:`
                : forcar === "assign"
                  ? `Direcionar a conversa de ${donoNome}:`
                  : `Devolver ao bot a conversa de ${donoNome}:`}
          </span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="motivo, para ficar no histórico"
            className="min-w-48 flex-1 rounded-lg border px-2 py-1 text-base outline-none md:text-xs"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
          <button
            onClick={() => call(forcar, true)}
            disabled={busy || motivo.trim().length < 3}
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-40"
          >
            {ROTULO_FORCADO[forcar]}
          </button>
          <button
            onClick={() => {
              setForcar(null);
              setMotivo("");
              setError(null);
            }}
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            cancelar
          </button>
        </div>
      )}
    </div>
  );
}
