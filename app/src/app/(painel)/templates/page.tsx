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
    // `order` antes do `limit`: sem ele, com mais de um canal ativo o Postgres
    // devolve qualquer um, e o template é criado na conta errada sem aviso. É
    // o mesmo furo que fez uma campanha inteira sair pelo número desconectado.
    // Aqui a escolha ainda é implícita — templates são da Meta, e esta
    // instalação usa Evolution —, mas ao menos é sempre o mesmo canal.
    supabase
      .from("channels")
      .select("id")
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
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
