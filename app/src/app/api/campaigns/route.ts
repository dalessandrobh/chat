/**
 * GET  /api/campaigns — campanhas com os números do painel
 * POST /api/campaigns — cria e já monta a fila de destinatários
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";
import { conferirNumeros } from "@/lib/conferir-numeros";

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
  /** Grupos a atingir. Vazio ou ausente quer dizer "todos os grupos". */
  groupIds: z.array(z.string().uuid()).max(50).optional(),
  /** Inclui quem ainda não tem grupo — quem entrou pela última planilha. */
  semGrupo: z.boolean().optional(),
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

  // Canal pausado não manda campanha. A checagem é aqui, e não só no disparo:
  // descobrir lá é descobrir com a campanha já criada e ninguém entendendo por
  // que ela não anda.
  const { data: canal } = await supabase
    .from("channels")
    .select("id, name, is_active")
    .eq("id", d.channelId)
    .maybeSingle();

  if (!canal) {
    return NextResponse.json({ error: "Canal não encontrado." }, { status: 404 });
  }
  if (!canal.is_active) {
    return NextResponse.json(
      { error: `O canal ${canal.name} está pausado. Retome-o em Canais ou escolha outro.` },
      { status: 409 }
    );
  }

  // Nasce agendada quando tem data, e rascunho quando não tem. Rascunho não
  // dispara: é onde se confere o texto antes de ele virar irreversível.
  const { data: campanha, error } = await supabase
    .from("campaigns")
    .insert({
      channel_id: d.channelId,
      company_id: agent.company_id,
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
      // O recorte fica gravado na campanha, e não só na fila que ele gerou.
      // É o que permite reusá-la como modelo depois: a cópia refaz a pergunta
      // contra a base de hoje, em vez de reenviar para uma lista congelada.
      tags: d.tags ?? [],
      group_ids: d.groupIds ?? [],
      sem_grupo: d.semGrupo ?? false,
      created_by: agent.id,
    })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // A fila sai do recorte que acabou de ser gravado — o banco lê da campanha,
  // não de parâmetros. Duas cópias do mesmo filtro seriam duas chances de
  // divergirem, e a que manda seria a invisível.
  const { data: total, error: filaError } = await supabase.rpc("enqueue_campaign", {
    p_campaign_id: campanha.id,
  });

  if (filaError) {
    return NextResponse.json({ error: filaError.message }, { status: 400 });
  }

  // Conferir quem existe no WhatsApp, agora que a fila está montada e antes de
  // qualquer disparo.
  //
  // Em 10/09/2026 uma campanha por um número novo mandou 86 mensagens, 20 para
  // números inexistentes, e o WhatsApp encerrou a sessão no meio. Descobrir
  // pelo disparo custa a reputação do número; descobrir aqui custa uma
  // pergunta em lote.
  //
  // Falha na conferência não derruba a campanha: sem ela o mundo volta a ser o
  // de antes, que é o mundo que funcionava.
  const { data: fila } = await supabase
    .from("campaign_recipients")
    .select("wa_id")
    .eq("campaign_id", campanha.id);

  const conferencia = await conferirNumeros({
    companyId: agent.company_id,
    channelId: d.channelId,
    waIds: (fila ?? []).map((l) => l.wa_id as string),
  });

  return NextResponse.json({
    campanha,
    // O total desconta quem saiu na conferência: é o número de gente que a
    // campanha vai mesmo alcançar, e é ele que a tela anuncia.
    destinatarios: Math.max(0, (total ?? 0) - conferencia.semWhatsapp),
    semWhatsapp: conferencia.semWhatsapp,
    conferenciaFalhou: conferencia.erro,
  });
}
