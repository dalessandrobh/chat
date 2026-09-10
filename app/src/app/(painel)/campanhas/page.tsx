import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageTemplates } from "@/lib/roles";
import { CampanhasClient } from "@/components/campanhas/CampanhasClient";

export const dynamic = "force-dynamic";

export default async function CampanhasPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: agent }, { data: channels }] = await Promise.all([
    supabase.from("agents").select("role").eq("id", user!.id).maybeSingle(),
    // Todos os canais ativos, não "o" canal.
    //
    // Antes era `.limit(1).maybeSingle()` sem ordem nenhuma, e isso funcionou
    // enquanto a empresa tinha um número só. Com dois, o Postgres devolvia
    // qualquer um dos dois — e uma campanha inteira saiu pelo número
    // desconectado, falhando contato por contato até o fim da lista.
    //
    // `connection_state` vem junto porque escolher o canal sem saber se ele
    // está no ar é escolher no escuro. `is_default` é por onde a escolha
    // começa: quem não quer escolher toda vez marca o padrão em Canais.
    //
    // Só ativos: canal pausado não dispara campanha, e oferecê-lo na lista
    // seria oferecer uma campanha que não anda.
    supabase
      .from("channels")
      .select("id, name, connection_state, display_phone_number, is_default")
      .eq("is_active", true)
      .order("created_at"),
  ]);

  if (!canManageTemplates(agent?.role)) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <CampanhasClient channels={channels ?? []} />
    </div>
  );
}
