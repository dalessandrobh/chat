"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CampoSenha } from "@/components/ui/CampoSenha";

/**
 * Onde o link do e-mail de recuperação cai.
 *
 * O token vem no fragmento da URL (#access_token=…), que o navegador não manda
 * para o servidor — por isso esta rota é pública e a sessão só existe depois
 * que o cliente lê o fragmento. Enquanto isso não acontece, mostrar o
 * formulário seria prometer algo que ainda pode falhar.
 */
export function NovaSenhaForm() {
  const [estado, setEstado] = useState<"conferindo" | "pronto" | "sem-sessao">("conferindo");
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) return setEstado("pronto");

      // O cliente pode ainda estar processando o fragmento; o evento avisa.
      const { data: sub } = supabase.auth.onAuthStateChange((_evento, sessao) => {
        setEstado(sessao ? "pronto" : "sem-sessao");
      });

      // Se em três segundos nada apareceu, o link venceu ou já foi usado.
      const t = setTimeout(() => setEstado((e) => (e === "conferindo" ? "sem-sessao" : e)), 3000);
      return () => {
        sub.subscription.unsubscribe();
        clearTimeout(t);
      };
    });
  }, []);

  async function salvar() {
    if (senha !== repetida) return setErro("As duas senhas não são iguais.");
    setBusy(true);
    setErro(null);

    const { error } = await supabaseBrowser().auth.updateUser({ password: senha });
    setBusy(false);

    if (error) return setErro(error.message);

    router.replace("/inbox");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div
        className="w-full max-w-sm rounded-xl border p-8 shadow-sm"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <h1 className="text-2xl font-semibold">Nova senha</h1>

        {estado === "conferindo" && (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Conferindo o link…
          </p>
        )}

        {estado === "sem-sessao" && (
          <>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Este link não vale mais. Ele expira depois de um tempo e só pode
              ser usado uma vez.
            </p>
            <a
              href="/login"
              className="mt-4 block w-full rounded-lg bg-wa-teal px-4 py-2.5 text-center text-sm font-medium text-white"
            >
              Pedir outro link
            </a>
          </>
        )}

        {estado === "pronto" && (
          <>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Escolha a senha que você vai usar para entrar.
            </p>

            <label className="mt-6 block text-sm font-medium">
              Senha
              <span className="mt-1 block">
                <CampoSenha
                  value={senha}
                  onChange={setSenha}
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="ao menos 8 caracteres"
                  className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-wa-teal"
                  style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                />
              </span>
            </label>

            <label className="mt-4 block text-sm font-medium">
              Repita a senha
              <span className="mt-1 block">
                <CampoSenha
                  value={repetida}
                  onChange={setRepetida}
                  autoComplete="new-password"
                  onEnter={() => {
                    if (senha.length >= 8 && senha === repetida) void salvar();
                  }}
                  className="rounded-lg border px-3 py-2 text-sm outline-none focus:border-wa-teal"
                  style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                />
              </span>
            </label>

            {erro && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
                {erro}
              </p>
            )}

            <button
              onClick={() => void salvar()}
              disabled={busy || senha.length < 8 || !repetida}
              className="mt-6 w-full rounded-lg bg-wa-teal px-4 py-2.5 text-sm font-medium text-white transition hover:bg-wa-dark disabled:opacity-60"
            >
              {busy ? "Salvando…" : "Salvar e entrar"}
            </button>

            <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
              A senha vale para todo o Supabase desta instalação — a mesma que
              você usa em qualquer outro sistema ligado a ele.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
