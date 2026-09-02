"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CampoSenha } from "@/components/ui/CampoSenha";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modo, setModo] = useState<"entrar" | "criar" | "recuperar">("entrar");

  const criandoConta = modo === "criar";
  const recuperando = modo === "recuperar";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setAviso(null);

    if (recuperando) {
      const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
        // Precisa ser caminho público: o token vem no fragmento da URL, que o
        // servidor não enxerga — sem isso o middleware manda para o login e o
        // link morre no caminho.
        redirectTo: `${window.location.origin}/nova-senha`,
      });
      setLoading(false);

      // Mesma resposta com e sem conta: dizer "esse e-mail não existe" entrega
      // quem é cliente para quem só está testando endereços.
      if (error) {
        setError(error.message);
        return;
      }
      setAviso(
        "Se houver conta com esse e-mail, o link de recuperação chega em instantes."
      );
      setModo("entrar");
      return;
    }

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
        setModo("entrar");
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
          {recuperando
            ? "Enviamos um link para você escolher outra senha"
            : criandoConta
              ? "Crie a conta da sua empresa"
              : "Painel de atendimento"}
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

        {!recuperando && (
          <label className="mt-4 block text-sm font-medium">
            Senha
            <span className="mt-1 block">
              <CampoSenha
                value={password}
                onChange={setPassword}
                required
                autoComplete={criandoConta ? "new-password" : "current-password"}
                minLength={criandoConta ? 8 : undefined}
                className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-wa-teal"
                style={{ background: "var(--bg)", borderColor: "var(--border)" }}
              />
            </span>
          </label>
        )}

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
            ? recuperando
              ? "Enviando…"
              : criandoConta
                ? "Criando…"
                : "Entrando…"
            : recuperando
              ? "Enviar link de recuperação"
              : criandoConta
                ? "Criar conta"
                : "Entrar"}
        </button>

        <div className="mt-3 flex flex-col gap-2 text-center text-sm">
          <button
            type="button"
            onClick={() => {
              setModo(criandoConta ? "entrar" : "criar");
              setError(null);
              setAviso(null);
            }}
            className="underline"
            style={{ color: "var(--muted)" }}
          >
            {criandoConta ? "Já tenho conta" : "Não tem conta? Cadastre sua empresa"}
          </button>

          {!criandoConta && (
            <button
              type="button"
              onClick={() => {
                setModo(recuperando ? "entrar" : "recuperar");
                setError(null);
                setAviso(null);
              }}
              className="underline"
              style={{ color: "var(--muted)" }}
            >
              {recuperando ? "Voltar para entrar" : "Recuperar sua senha?"}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
