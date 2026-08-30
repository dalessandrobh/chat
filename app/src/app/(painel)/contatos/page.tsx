import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageTemplates } from "@/lib/roles";
import { ContatosClient } from "@/components/contatos/ContatosClient";

export const dynamic = "force-dynamic";

export default async function ContatosPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: agent } = await supabase
    .from("agents").select("role").eq("id", user!.id).maybeSingle();

  if (!canManageTemplates(agent?.role)) redirect("/inbox");

  return <div className="h-full overflow-y-auto"><ContatosClient /></div>;
}
