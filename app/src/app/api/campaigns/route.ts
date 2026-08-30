/**
 * GET  /api/campaigns — campanhas com os números do painel
 * POST /api/campaigns — cria e já monta a fila de destinatários
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

const schema = z.object({
  name: z.string().trim().min(1, "Dê um nome à campanha").max(160),
  channelId: z.string().uuid(),
  mediaKind: z.enum(["text", "image", "video", "audio", "document"]),
  body: z.string().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  mediaFilename: z.string().max(255).optional(),
  mediaMime: z.string().max(120).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string()).max(20).optional(),
  intervalMinSeconds: z.number().int().min(5).max(3600).optional(),
  intervalMaxSeconds: z.number().int().min(5).max(7200).optional(),
  dailyLimit: z.number().int().min(1).max(1000).optional(),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("campaign_stats")
    .select("*")
    .order("scheduled_at", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campanhas: data ?? [] });
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) {
    return NextResponse.json({ error: "Sem permissão para criar campanhas." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const d = parsed.data;

  if (d.intervalMinSeconds && d.intervalMaxSeconds && d.intervalMinSeconds > d.intervalMaxSeconds) {
    return NextResponse.json({ error: "O intervalo mínimo passou do máximo." }, { status: 400 });
  }

  const supabase = await supabaseServer();

  // Nasce agendada quando tem data, e rascunho quando não tem. Rascunho não
  // dispara: é onde se confere o texto antes de ele virar irreversível.
  const { data: campanha, error } = await supabase
    .from("campaigns")
    .insert({
      channel_id: d.channelId,
      name: d.name,
      status: d.scheduledAt ? "scheduled" : "draft",
      media_kind: d.mediaKind,
      body: d.body ?? null,
      media_url: d.mediaUrl ?? null,
      media_filename: d.mediaFilename ?? null,
      media_mime: d.mediaMime ?? null,
      scheduled_at: d.scheduledAt ?? null,
      interval_min_seconds: d.intervalMinSeconds ?? 45,
      interval_max_seconds: d.intervalMaxSeconds ?? 120,
      daily_limit: d.dailyLimit ?? 150,
      window_start: d.windowStart ?? "09:00",
      window_end: d.windowEnd ?? "19:00",
      created_by: agent.id,
    })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: total, error: filaError } = await supabase.rpc("enqueue_campaign", {
    p_campaign_id: campanha.id,
    p_tags: d.tags?.length ? d.tags : null,
  });

  if (filaError) {
    return NextResponse.json({ error: filaError.message }, { status: 400 });
  }

  return NextResponse.json({ campanha, destinatarios: total ?? 0 });
}
