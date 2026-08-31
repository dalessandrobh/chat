/**
 * POST /api/channels — cadastra um número novo
 *
 * Cria a instância na Evolution já com o webhook apontado para cá e grava a
 * linha em chat.channels. O pareamento é o passo seguinte, pelo botão de QR
 * da tela — quem cadastra nem sempre é quem está com o celular na mão.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageChannels } from "@/lib/roles";
import { EvolutionApiError, createInstance } from "@/lib/evolution/client";
import { serverEnv } from "@/lib/env";

const bodySchema = z.object({
  name: z.string().trim().min(2, "Dê um nome ao canal").max(60),
  /**
   * Servidor próprio da empresa, quando houver. Em branco usa o da
   * plataforma — e o valor é **copiado** para a linha do canal, não
   * consultado no ambiente na hora de enviar. A diferença importa: no dia em
   * que o padrão mudar, o canal antigo continua falando com o servidor onde a
   * sessão dele existe.
   */
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(8).optional(),
});

/** Nome de instância é único e vive numa URL: sem acento, sem espaço. */
function paraInstancia(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return base || "canal";
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  if (!canManageChannels(agent.role)) {
    return NextResponse.json({ error: "Só administradores cadastram canais." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { name } = parsed.data;

  // Nome já em uso ganha sufixo. Colidir com uma instância da Evolution que o
  // painel não conhece dá um erro obscuro lá na frente.
  const raiz = paraInstancia(name);
  const { data: existentes } = await db
    .from("channels")
    .select("instance_name")
    .like("instance_name", `${raiz}%`);

  const tomados = new Set((existentes ?? []).map((c) => c.instance_name));
  let instanceName = raiz;
  for (let i = 2; tomados.has(instanceName); i++) instanceName = `${raiz}-${i}`;

  // A linha primeiro: se a Evolution recusar, apagar uma linha recém-criada é
  // trivial; instância órfã ocupa o nome para sempre.
  const baseUrl = (parsed.data.baseUrl ?? serverEnv.evolution.baseUrl).replace(/\/+$/, "");
  const apiKey = parsed.data.apiKey ?? serverEnv.evolution.apiKey;

  // Token próprio deste canal. Um por canal significa que vazar o de uma
  // empresa não autoriza mandar evento falso no inbox de outra.
  const webhookToken = randomBytes(32).toString("hex");

  const { data: channel, error } = await db
    .from("channels")
    .insert({
      name,
      provider: "evolution",
      instance_name: instanceName,
      is_active: true,
      connection_state: "close",
      company_id: agent.company_id,
      base_url: baseUrl,
    })
    .select("id, name, provider, instance_name, display_phone_number, connection_state, connected_at, is_active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await db.rpc("set_channel_secret", {
      p_channel_id: channel.id,
      p_name: "api_key",
      p_value: apiKey,
    });
    await db.rpc("set_channel_secret", {
      p_channel_id: channel.id,
      p_name: "webhook_token",
      p_value: webhookToken,
    });

    await createInstance(
      { baseUrl, apiKey },
      {
        instanceName,
        // A URL carrega o canal: é assim que o webhook sabe de quem é o evento
        // antes de conferir o token, e cada canal confere o seu.
        webhookUrl: `${serverEnv.evolution.webhookTarget}/${channel.id}`,
        webhookToken,
      }
    );
  } catch (err) {
    await db.from("channels").delete().eq("id", channel.id);
    const message = err instanceof EvolutionApiError ? err.message : String(err);
    return NextResponse.json({ error: `Evolution recusou: ${message}` }, { status: 502 });
  }

  return NextResponse.json({ channel });
}
