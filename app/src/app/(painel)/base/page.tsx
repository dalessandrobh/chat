import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageKnowledge } from "@/lib/roles";
import { BaseClient } from "@/components/base/BaseClient";

export const dynamic = "force-dynamic";

export default async function BasePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agent } = await supabase
    .from("agents")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  if (!canManageKnowledge(agent?.role)) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <BaseClient />
    </div>
  );
}
