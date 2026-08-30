"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  roleLabel,
  type AgentRole,
} from "@/lib/roles";

interface Agent {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AgentRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

type Aviso = { kind: "ok" | "erro"; text: string } | null;

const ROLE_BADGE: Record<AgentRole, string> = {
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  manager: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  agent: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export function UsuariosClient({ currentUserId }: { currentUserId: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  /** Senha recém-gerada: aparece uma vez e não volta. */
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; password: string } | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/agents");
    const json = await response.json();
    if (response.ok) setAgents(json.agents);
    else setAviso({ kind: "erro", text: json.error });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function patch(id: string, body: Record<string, unknown>) {
    setAviso(null);
    const response = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) {
      setAviso({ kind: "erro", text: json.error });
      return false;
    }
    await refresh();
    return true;
  }

  async function remove(agent: Agent) {
    const nome = agent.full_name ?? agent.email;
    if (
      !confirm(
        `Remover ${nome} do Chat?\n\n` +
          `A conta de login continua existindo (é compartilhada com o dsearch) — ` +
          `só o acesso a este painel é revogado.`
      )
    ) {
      return;
    }

    const response = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAviso({ kind: "erro", text: json.error ?? "Falha ao remover." });
      return;
    }
    setAviso({ kind: "ok", text: `${nome} não tem mais acesso ao Chat.` });
    await refresh();
  }

  async function resetPassword(agent: Agent) {
    if (
      !confirm(
        `Gerar uma senha nova para ${agent.email}?\n\n` +
          `Atenção: a senha vale para todo o Supabase, então muda também no ` +
          `dsearch se a pessoa usar os dois.`
      )
    ) {
      return;
    }

    const response = await fetch(`/api/agents/${agent.id}/password`, { method: "POST" });
    const json = await response.json();
    if (!response.ok) {
      setAviso({ kind: "erro", text: json.error });
      return;
    }
    setSenhaGerada({ email: agent.email ?? "", password: json.password });
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Quem entra no painel e o que cada um pode fazer.
        </p>
        <button
          onClick={() => setCreating((v) => !v)}
          className="ml-auto rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
        >
          {creating ? "Fechar" : "Novo usuário"}
        </button>
      </div>

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

      {senhaGerada && (
        <SenhaGerada dados={senhaGerada} onClose={() => setSenhaGerada(null)} />
      )}

      {creating && (
        <CreateForm
          onDone={async (result, senha) => {
            setAviso(result);
            if (result.kind === "ok") {
              setCreating(false);
              if (senha) setSenhaGerada(senha);
              await refresh();
            }
          }}
        />
      )}

      <div className="mt-6 space-y-2">
        {loading && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Carregando…
          </p>
        )}

        {agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            isSelf={agent.id === currentUserId}
            onPatch={patch}
            onRemove={remove}
            onResetPassword={resetPassword}
          />
        ))}
      </div>

      <Legenda />
    </div>
  );
}

// -----------------------------------------------------------------------------

function AgentRow({
  agent,
  isSelf,
  onPatch,
  onRemove,
  onResetPassword,
}: {
  agent: Agent;
  isSelf: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>;
  onRemove: (agent: Agent) => void;
  onResetPassword: (agent: Agent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(agent.full_name ?? "");
  const [busy, setBusy] = useState(false);

  async function salvarNome() {
    setBusy(true);
    const ok = await onPatch(agent.id, { fullName: nome });
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: "var(--panel)",
        borderColor: "var(--border)",
        opacity: agent.is_active ? 1 : 0.6,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="rounded-lg border px-2 py-1 text-sm outline-none"
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}
            />
            <button
              onClick={salvarNome}
              disabled={busy}
              className="rounded-lg bg-wa-green px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              onClick={() => {
                setNome(agent.full_name ?? "");
                setEditing(false);
              }}
              className="text-xs underline"
              style={{ color: "var(--muted)" }}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <span className="font-medium">{agent.full_name ?? "(sem nome)"}</span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs underline"
              style={{ color: "var(--muted)" }}
            >
              editar
            </button>
          </>
        )}

        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_BADGE[agent.role]}`}>
          {roleLabel(agent.role)}
        </span>

        {!agent.is_active && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            Sem acesso
          </span>
        )}
        {isSelf && (
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
            (você)
          </span>
        )}
      </div>

      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        {agent.email} ·{" "}
        {agent.last_sign_in_at
          ? `último acesso em ${new Date(agent.last_sign_in_at).toLocaleDateString("pt-BR")}`
          : "nunca entrou"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={agent.role}
          disabled={isSelf}
          onChange={(e) => void onPatch(agent.id, { role: e.target.value })}
          className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>

        <button
          onClick={() => void onPatch(agent.id, { isActive: !agent.is_active })}
          disabled={isSelf}
          className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
        >
          {agent.is_active ? "Revogar acesso" : "Liberar acesso"}
        </button>

        <button
          onClick={() => onResetPassword(agent)}
          className="rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: "var(--border)" }}
        >
          Nova senha
        </button>

        <button
          onClick={() => onRemove(agent)}
          disabled={isSelf}
          className="ml-auto rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:border-red-900 dark:text-red-400"
        >
          Remover do Chat
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function CreateForm({
  onDone,
}: {
  onDone: (
    result: { kind: "ok" | "erro"; text: string },
    senha: { email: string; password: string } | null
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AgentRole>("agent");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName, role }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);

      onDone(
        {
          kind: "ok",
          text: json.reused
            ? `${email} já tinha conta no Supabase compartilhado; liberei o acesso ao Chat sem mexer na senha.`
            : `${email} criado com acesso ao Chat.`,
        },
        json.password ? { email, password: json.password } : null
      );
    } catch (err) {
      onDone({ kind: "erro", text: err instanceof Error ? err.message : String(err) }, null);
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
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Nome
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
        </label>

        <label className="text-sm">
          E-mail
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
        </label>

        <label className="text-sm">
          Papel
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AgentRole)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
        {ROLE_DESCRIPTION[role]} A senha é gerada agora e aparece uma única vez.
      </p>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Criando…" : "Criar usuário"}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------

function SenhaGerada({
  dados,
  onClose,
}: {
  dados: { email: string; password: string };
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Anote agora — esta senha não aparece de novo
      </p>
      <p className="mt-2 font-mono text-sm text-amber-900 dark:text-amber-100">
        {dados.email} · {dados.password}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void navigator.clipboard.writeText(dados.password)}
          className="rounded-lg border border-amber-400 px-2 py-1 text-xs text-amber-900 dark:text-amber-200"
        >
          Copiar senha
        </button>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs underline text-amber-900 dark:text-amber-200"
        >
          Já anotei
        </button>
      </div>
    </div>
  );
}

function Legenda() {
  return (
    <div
      className="mt-8 rounded-lg border p-4 text-sm"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="font-medium">O que cada papel pode</p>
      <dl className="mt-2 space-y-1" style={{ color: "var(--muted)" }}>
        {ROLES.map((role) => (
          <div key={role} className="flex gap-2">
            <dt className="w-32 shrink-0 font-medium">{ROLE_LABEL[role]}</dt>
            <dd>{ROLE_DESCRIPTION[role]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        As contas de login são compartilhadas com o dsearch. “Remover do Chat”
        revoga só o acesso a este painel; a conta continua existindo.
      </p>
    </div>
  );
}
