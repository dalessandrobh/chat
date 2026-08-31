"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [criandoConta, setCriandoConta] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setAviso(null);

    if (criandoConta) {
      const { data, error } = await supabaseBrowser().auth.signUp({ email, password });
      setLoading(false);

      if (error) {
        setError(error.message);
        return;
      }

      // Sem sessão na resposta = confirmação de e-mail pendente. Dizer isso é
      // melhor do que deixar a pessoa achando que deu errado.
      if (!data.session) {
        setAviso("Conta criada. Confirme o e-mail que acabamos de enviar e volte para entrar.");
        setCriandoConta(false);
        return;
      }

      router.replace("/comecar");
      router.refresh();
      return;
    }

    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : error.message
      );
      setLoading(false);
      return;
    }

    // refresh() força o middleware a rodar de novo com o cookie novo.
    router.replace(next);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border p-8 shadow-sm"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {criandoConta ? "Crie a conta da sua empresa" : "Painel de atendimento"}
        </p>

        <label className="mt-6 block text-sm font-medium">
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-wa-teal"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
        </label>

        <label className="mt-4 block text-sm font-medium">
          Senha
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-wa-teal"
            style={{ background: "var(--bg)", borderColor: "var(--border)" }}
          />
        </label>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {aviso && (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
            {aviso}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-wa-teal px-4 py-2.5 text-sm font-medium text-white transition hover:bg-wa-dark disabled:opacity-60"
        >
          {loading
            ? criandoConta
              ? "Criando…"
              : "Entrando…"
            : criandoConta
              ? "Criar conta"
              : "Entrar"}
        </button>

        <button
          type="button"
          onClick={() => {
            setCriandoConta((v) => !v);
            setError(null);
            setAviso(null);
          }}
          className="mt-3 w-full text-center text-sm underline"
          style={{ color: "var(--muted)" }}
        >
          {criandoConta
            ? "Já tenho conta"
            : "Não tem conta? Cadastre sua empresa"}
        </button>
      </form>
    </main>
  );
}
