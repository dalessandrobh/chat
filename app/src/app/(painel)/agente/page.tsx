import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageKnowledge } from "@/lib/roles";
import { AgenteClient } from "@/components/agente/AgenteClient";

export const dynamic = "force-dynamic";

export default async function AgentePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agent } = await supabase
    .from("agents")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  // Mesma régua da base: quem decide o que o bot diz decide como ele diz.
  if (!canManageKnowledge(agent?.role)) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <AgenteClient />
    </div>
  );
}
