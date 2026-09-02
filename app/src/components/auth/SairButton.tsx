"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Sair da conta.
 *
 * O `signOut` apaga a sessão nos cookies, e o `refresh` obriga o middleware a
 * rodar de novo sem ela — sem isso a tela seguiria pintada com os dados de
 * quem acabou de sair até alguém apertar F5.
 */
export function SairButton() {
  const [saindo, setSaindo] = useState(false);
  const router = useRouter();

  async function sair() {
    setSaindo(true);
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={() => void sair()}
      disabled={saindo}
      className="rounded-lg border px-2 py-1 text-xs transition hover:bg-black/[0.03] disabled:opacity-50 dark:hover:bg-white/[0.06]"
      style={{ borderColor: "var(--border)" }}
    >
      {saindo ? "Saindo…" : "Sair"}
    </button>
  );
}
