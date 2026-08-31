/**
 * POST /api/templates/sync
 * Puxa o estado real dos templates na Meta e reconcilia o espelho local.
 *
 * A fonte da verdade é a Meta. Templates podem ser criados, pausados ou
 * reprovados fora do painel — e o webhook de status pode se perder. Este
 * endpoint é a rede de segurança; vale rodar de hora em hora pelo n8n.
 */

import { NextResponse } from "next/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listTemplates, MetaApiError } from "@/lib/meta/client";
import { serverEnv } from "@/lib/env";

export async function POST(request: Request) {
  // Aceita tanto um admin no painel quanto o n8n com service token.
  const agent = await currentAgent();
  const isService = hasServiceToken(request);
  if (!isService && !agent) return unauthorized();

  const db = supabaseAdmin();

  // Todos os templates pertencem à WABA configurada; resolvemos o canal dela.
  const { data: channel } = await db
    .from("channels")
    .select("id, company_id")
    .eq("phone_number_id", serverEnv.meta.phoneNumberId)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json(
      { error: "Canal não cadastrado em chat.channels. Rode o seed primeiro." },
      { status: 400 }
    );
  }

  let remote;
  try {
    remote = await listTemplates();
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : String(err);
    return NextResponse.json({ error: `Falha ao consultar a Meta: ${message}` }, { status: 502 });
  }

  const now = new Date().toISOString();
  const rows = remote.map((t) => ({
    channel_id: channel.id,
    company_id: channel.company_id,
    name: t.name,
    language: t.language,
    category: (t.category ?? "UTILITY").toUpperCase(),
    components: t.components ?? [],
    meta_template_id: t.id,
    status: (t.status ?? "PENDING").toUpperCase(),
    quality_rating: t.quality_score?.score ?? null,
    rejected_reason: t.rejected_reason ?? null,
    last_synced_at: now,
  }));

  if (rows.length) {
    const { error } = await db
      .from("templates")
      .upsert(rows, { onConflict: "channel_id,name,language" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Templates que sumiram na Meta mas seguem locais: marcamos DISABLED em vez
  // de apagar, para não perder o histórico de qual template foi usado numa
  // mensagem já enviada.
  const remoteKeys = new Set(remote.map((t) => `${t.name}|${t.language}`));
  const { data: locals } = await db
    .from("templates")
    .select("id, name, language, status")
    .eq("channel_id", channel.id)
    .neq("status", "LOCAL");

  const orphans = (locals ?? []).filter(
    (t) => !remoteKeys.has(`${t.name}|${t.language}`) && t.status !== "DISABLED"
  );

  if (orphans.length) {
    await db
      .from("templates")
      .update({ status: "DISABLED", last_synced_at: now })
      .in("id", orphans.map((t) => t.id));
  }

  return NextResponse.json({
    ok: true,
    sincronizados: rows.length,
    desativados: orphans.length,
  });
}
