/**
 * GET   /api/campaigns/:id — o conteúdo exato que foi (ou será) enviado
 * PATCH /api/campaigns/:id — pausa, retoma, cancela, agenda ou corrige o texto
 *
 * Pausar é a alavanca que importa. Campanha grande sai por horas, e a hora em
 * que alguém percebe o erro de texto é sempre depois do primeiro envio.
 *
 * Por isso o texto também se corrige aqui, com a campanha correndo. Quem já
 * recebeu recebeu — não há como voltar atrás disso —, mas a fila que falta
 * passa a sair certa: `claim_next_send` lê o corpo da campanha a cada envio,
 * então salvar já basta. O que não se corrige é campanha encerrada ou
 * cancelada: ali não sobrou fila para aproveitar a correção.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

const schema = z.object({
  status: z.enum(["scheduled", "running", "paused", "canceled"]).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** Texto da mensagem, ou legenda da mídia. Vale para a fila que falta. */
  body: z.string().max(4000).optional(),
});

/** Onde ainda existe fila para a correção aproveitar. */
const CORRIGIVEL = ["draft", "scheduled", "running", "paused"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const supabase = await supabaseServer();

  // Um destinatário real serve de exemplo para o {nome}: ver o texto cru não
  // responde a pergunta que se faz olhando uma campanha já enviada, que é
  // "o que a pessoa leu".
  const [{ data: campanha, error }, { data: exemplo }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        // O recorte e o canal vão junto: é com eles que a tela abre o
        // formulário pré-preenchido para reusar a campanha como modelo.
        "id, name, status, media_kind, body, media_url, media_filename, media_mime, " +
          "scheduled_at, started_at, finished_at, window_start, window_end, weekdays, " +
          "interval_min_seconds, interval_max_seconds, daily_limit, " +
          "channel_id, tags, group_ids, sem_grupo"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("campaign_recipients")
      .select("name")
      .eq("campaign_id", id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campanha) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  return NextResponse.json({ campanha, exemploNome: exemplo?.name ?? null });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.status) patch.status = parsed.data.status;
  if (parsed.data.scheduledAt !== undefined) patch.scheduled_at = parsed.data.scheduledAt;
  if (parsed.data.body !== undefined) patch.body = parsed.data.body;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
  }

  const supabase = await supabaseServer();

  if (parsed.data.body !== undefined) {
    const { data: alvo } = await supabase
      .from("campaigns")
      .select("status, media_kind")
      .eq("id", id)
      .maybeSingle();

    if (!alvo) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

    if (!CORRIGIVEL.includes(alvo.status)) {
      return NextResponse.json(
        { error: "Esta campanha já terminou; não há fila para o texto novo alcançar." },
        { status: 409 }
      );
    }

    // O `check` da tabela recusaria de qualquer jeito, mas com a mensagem do
    // Postgres. Campanha de texto sem texto é o erro fácil de cometer editando.
    if (alvo.media_kind === "text" && parsed.data.body.trim() === "") {
      return NextResponse.json(
        { error: "Campanha de texto não pode ficar sem texto." },
        { status: 400 }
      );
    }
  }

  // "Disparar agora" pula a promoção scheduled → running feita no banco, que é
  // onde started_at seria preenchido — e é o primeiro dado que se procura
  // quando algo sai errado. Só na primeira vez: "Retomar" também manda
  // `running`, e sobrescrever aqui apagaria a hora em que a campanha começou.
  if (parsed.data.status === "running") {
    const { data: atual } = await supabase
      .from("campaigns")
      .select("started_at")
      .eq("id", id)
      .maybeSingle();
    if (atual && !atual.started_at) patch.started_at = new Date().toISOString();
  }
  if (parsed.data.status === "canceled") patch.finished_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .select("id, name, status, scheduled_at, body")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ campanha: data });
}
