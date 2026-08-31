"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Primeira tela de quem acabou de se cadastrar. Substitui o "acesso pendente"
 * para quem chegou sozinho: em vez de esperar alguém liberar no banco, cria a
 * própria empresa e entra como administrador.
 */
export function ComecarClient({ email }: { email: string }) {
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  async function criar() {
    setBusy(true);
    setErro(null);
    const r = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErro(j.error);
      setBusy(false);
      return;
    }
    router.replace("/inbox");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Criar sua empresa</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Você entrou como {email}. Dê um nome à empresa para começar — você
          será o administrador dela e poderá convidar o resto da equipe depois.
        </p>

        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && nome.trim().length >= 2) void criar();
          }}
          placeholder="Nome da empresa"
          className="mt-4 w-full rounded-lg border px-3 py-2 text-sm"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        />

        <button
          onClick={() => void criar()}
          disabled={busy || nome.trim().length < 2}
          className="mt-3 w-full rounded-lg bg-wa-teal px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Criando…" : "Criar e entrar"}
        </button>

        {erro && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <p className="mt-6 text-xs" style={{ color: "var(--muted)" }}>
          Se você foi convidado por alguém, não crie empresa aqui: peça para a
          pessoa liberar seu acesso em Usuários.
        </p>
      </div>
    </main>
  );
}
