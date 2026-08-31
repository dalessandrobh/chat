import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PlataformaClient } from "@/components/plataforma/PlataformaClient";

export const dynamic = "force-dynamic";

/**
 * Fora do grupo (painel) de propósito: esta tela não é de uma empresa, é de
 * quem opera a instalação. Deixá-la ao lado das outras convidaria a colocar um
 * "ou é o dono" dentro das regras de acesso, que é exatamente o que se evitou.
 */
export default async function PlataformaPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: ehDono } = await supabase.rpc("is_platform_owner");

  // Quem não é dono não descobre que a tela existe.
  if (!ehDono) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <PlataformaClient />
    </div>
  );
}
