import { supabaseServer } from "@/lib/supabase/server";
import { CanaisClient, type Channel } from "@/components/canais/CanaisClient";
import { canManageChannels } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function CanaisPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: channels }, { data: agent }] = await Promise.all([
    supabase
      .from("channels")
      .select(
        "id, name, provider, instance_name, display_phone_number, connection_state, connected_at, is_active, base_url"
      )
      .order("created_at", { ascending: true }),
    supabase.from("agents").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <CanaisClient
        initial={(channels ?? []) as Channel[]}
        canManage={canManageChannels(agent?.role)}
      />
    </div>
  );
}
