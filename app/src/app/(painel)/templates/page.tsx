import { supabaseServer } from "@/lib/supabase/server";
import { TemplatesClient } from "@/components/templates/TemplatesClient";
import type { Template } from "@/lib/types";
import { canManageTemplates } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: templates }, { data: channel }, { data: agent }] = await Promise.all([
    supabase.from("templates").select("*").order("updated_at", { ascending: false }),
    supabase.from("channels").select("id").eq("is_active", true).limit(1).maybeSingle(),
    supabase.from("agents").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <TemplatesClient
        initial={(templates ?? []) as Template[]}
        channelId={channel?.id ?? null}
        canEdit={canManageTemplates(agent?.role)}
      />
    </div>
  );
}
