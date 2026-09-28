import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ComecarClient } from "@/components/comecar/ComecarClient";
import { SemAcesso } from "@/components/comecar/SemAcesso";

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

  // Sem linha nenhuma em `chat.agents`, criar empresa é a saída errada: quem
  // se cadastrou sozinho tem a linha (o gatilho a cria), então a falta dela
  // quer dizer conta removida de Usuários ou nunca liberada. Oferecer o
  // formulário aqui é convidar a pessoa a fazer uma segunda empresa com o nome
  // da que ela já tem — e a função do banco recusaria no fim, depois de ela
  // digitar o nome.
  if (!agent) return <SemAcesso email={user.email ?? ""} />;

  return <ComecarClient email={user.email ?? ""} />;
}
