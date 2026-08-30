/**
 * PATCH  /api/agents/:id — altera nome, papel ou ativação
 * DELETE /api/agents/:id — tira a pessoa do Chat
 *
 * DELETE remove a linha de chat.agents e nada mais. A conta em auth.users
 * fica de pé de propósito: este Auth é compartilhado com o dsearch, e apagar
 * o usuário aqui derrubaria o acesso dela lá também. Tirar do Chat é tirar do
 * Chat.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { ROLES, canManageUsers, type AgentRole } from "@/lib/roles";

const patchSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES as [AgentRole, ...AgentRole[]]).optional(),
  isActive: z.boolean().optional(),
});

function forbidden(message = "Só administradores gerenciam usuários.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageUsers(agent.role)) return forbidden();

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { fullName, role, isActive } = parsed.data;

  // Rebaixar ou desativar a si mesmo é quase sempre engano, e o estrago é
  // imediato: a próxima tela já nega. Renomear-se continua liberado.
  if (id === agent.id && (role !== undefined || isActive !== undefined)) {
    return forbidden("Você não pode mudar o próprio papel nem se desativar.");
  }

  const patch: Record<string, unknown> = {};
  if (fullName !== undefined) patch.full_name = fullName;
  if (role !== undefined) patch.role = role;
  if (isActive !== undefined) patch.is_active = isActive;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("agents")
    .update(patch)
    .eq("id", id)
    .select("id, email, full_name, role, is_active, created_at")
    .single();

  if (error) {
    // O gatilho guard_last_admin fala em português e a mensagem é útil ao
    // usuário; repassar é melhor do que traduzir para "erro 400".
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ agent: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageUsers(agent.role)) return forbidden();

  const { id } = await params;
  if (id === agent.id) return forbidden("Você não pode remover a si mesmo.");

  const { error } = await supabaseAdmin().from("agents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
