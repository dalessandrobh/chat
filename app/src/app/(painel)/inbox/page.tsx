import { supabaseServer } from "@/lib/supabase/server";
import { InboxClient } from "@/components/inbox/InboxClient";
import type { InboxRow, Template } from "@/lib/types";

// A lista muda o tempo todo; cache não faz sentido aqui.
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await supabaseServer();

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
      initialRows={(rows ?? []) as InboxRow[]}
      templates={(templates ?? []) as Template[]}
    />
  );
}
