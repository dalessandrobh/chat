import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageKnowledge } from "@/lib/roles";
import { AjustesClient } from "@/components/ajustes/AjustesClient";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agent } = await supabase
    .from("agents")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  // Mesma régua da base: quem decide o que o bot diz decide também o que ele lê.
  if (!canManageKnowledge(agent?.role)) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <AjustesClient />
    </div>
  );
}
