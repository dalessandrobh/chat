import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageTemplates } from "@/lib/roles";
import { CampanhasClient } from "@/components/campanhas/CampanhasClient";

export const dynamic = "force-dynamic";

export default async function CampanhasPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: agent }, { data: channel }] = await Promise.all([
    supabase.from("agents").select("role").eq("id", user!.id).maybeSingle(),
    supabase.from("channels").select("id, name").eq("is_active", true).limit(1).maybeSingle(),
  ]);

  if (!canManageTemplates(agent?.role)) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <CampanhasClient channelId={channel?.id ?? null} />
    </div>
  );
}
