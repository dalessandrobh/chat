import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent } from "@/lib/auth";
import { InboxClient } from "@/components/inbox/InboxClient";
import type { InboxRow, Template } from "@/lib/types";

// A lista muda o tempo todo; cache não faz sentido aqui.
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await supabaseServer();
  // Quem está olhando. A tela precisa saber para distinguir "minha conversa"
  // de "conversa de outro atendente" — o layout já barrou quem não é agente.
  const agent = await currentAgent();

  // Carga inicial no servidor para a tela já abrir preenchida; a partir daí
  // o Realtime mantém atualizado.
  const [{ data: rows }, { data: templates }] = await Promise.all([
    supabase
      .from("inbox")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase.from("templates").select("*").eq("status", "APPROVED"),
  ]);

  return (
    <InboxClient
      agenteId={agent?.id ?? null}
      initialRows={(rows ?? []) as InboxRow[]}
      templates={(templates ?? []) as Template[]}
    />
  );
}
