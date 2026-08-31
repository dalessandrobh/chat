/**
 * GET   /api/channels/:id/secrets — quais credenciais estão preenchidas
 * PUT   /api/channels/:id/secrets — grava uma credencial
 * DELETE                          — apaga uma credencial
 *
 * O GET devolve **nomes**, nunca valores. Não existe caminho no painel que
 * leia uma credencial de volta: quem precisa do valor é o servidor na hora de
 * enviar, e ele lê direto do cofre.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageChannels } from "@/lib/roles";
import { esquecerCredenciais } from "@/lib/canais";

/** O que se pode guardar. Lista fechada: nome livre viraria depósito de tudo. */
const NOMES = ["api_key", "webhook_token", "access_token", "app_secret", "verify_token"] as const;

const putSchema = z.object({
  name: z.enum(NOMES),
  value: z.string().trim().min(8, "Credencial curta demais para ser real").max(4000),
});

function proibido() {
  return NextResponse.json(
    { error: "Só administradores mexem nas credenciais do canal." },
    { status: 403 }
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageChannels(agent.role)) return proibido();

  const { id } = await params;
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("channel_secret_names", { p_channel_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ definidas: (data as string[]) ?? [] });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageChannels(agent.role)) return proibido();

  const { id } = await params;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  // Pela sessão do usuário: a própria função confere se ele é administrador da
  // empresa dona do canal. Fazer isso com chave de serviço passaria por cima
  // dessa checagem.
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_channel_secret", {
    p_channel_id: id,
    p_name: parsed.data.name,
    p_value: parsed.data.value,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  esquecerCredenciais(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageChannels(agent.role)) return proibido();

  const { id } = await params;
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!NOMES.includes(name as (typeof NOMES)[number])) {
    return NextResponse.json({ error: "Credencial desconhecida" }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("clear_channel_secret", {
    p_channel_id: id,
    p_name: name,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  esquecerCredenciais(id);
  return NextResponse.json({ ok: true });
}

/** Endereço do servidor: não é segredo, mora na própria linha do canal. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageChannels(agent.role)) return proibido();

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const baseUrl = z.string().trim().url().safeParse((body as { baseUrl?: string })?.baseUrl);
  if (!baseUrl.success) {
    return NextResponse.json({ error: "Endereço inválido" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("channels")
    .update({ base_url: baseUrl.data.replace(/\/+$/, "") })
    .eq("id", id)
    .eq("company_id", agent.company_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  esquecerCredenciais(id);
  return NextResponse.json({ ok: true });
}
