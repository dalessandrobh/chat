import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ComecarClient } from "@/components/comecar/ComecarClient";

export const dynamic = "force-dynamic";

export default async function ComecarPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: agent } = await supabase
    .from("agents")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();

  // Já tem empresa: esta tela não tem mais o que fazer.
  if (agent?.company_id) redirect("/inbox");

  return <ComecarClient email={user.email ?? ""} />;
}
