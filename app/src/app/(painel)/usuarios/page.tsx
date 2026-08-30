import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageUsers } from "@/lib/roles";
import { UsuariosClient } from "@/components/usuarios/UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agent } = await supabase
    .from("agents")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  // Gestor e atendente não têm o que fazer aqui.
  if (!canManageUsers(agent?.role)) redirect("/inbox");

  return (
    <div className="h-full overflow-y-auto">
      <UsuariosClient currentUserId={user!.id} />
    </div>
  );
}
