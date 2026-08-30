/**
 * GET  /api/agents — lista o time
 * POST /api/agents — cria um usuário e libera o acesso ao Chat
 *
 * Detalhe que manda no arquivo inteiro: este Supabase Auth é compartilhado
 * com o dsearch. Criar usuário aqui cria um login que vale nos dois; por isso
 * o acesso ao Chat é uma linha em chat.agents, e não a mera existência da
 * conta. Quem tiver conta e não tiver linha ativa não entra.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { ROLES, canManageUsers, type AgentRole } from "@/lib/roles";

const createSchema = z.object({
  email: z.string().email("E-mail inválido"),
  fullName: z.string().trim().min(1, "Informe o nome").max(120),
  role: z.enum(ROLES as [AgentRole, ...AgentRole[]]),
  /** Opcional: sem isso geramos uma e devolvemos uma única vez. */
  password: z.string().min(8, "A senha precisa de ao menos 8 caracteres").max(72).optional(),
});

function forbidden() {
  return NextResponse.json(
    { error: "Só administradores gerenciam usuários." },
    { status: 403 }
  );
}

/** Senha legível de digitar, mas sem padrão adivinhável. */
function generatePassword(): string {
  const alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

// -----------------------------------------------------------------------------

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageUsers(agent.role)) return forbidden();

  const db = supabaseAdmin();

  const { data: agents, error } = await db
    .from("agents")
    .select("id, email, full_name, role, is_active, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Último acesso mora em auth.users, fora do schema chat. Vale a chamada
  // extra: é o que mostra quem recebeu acesso e nunca entrou.
  const { data: authUsers } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const lastSignIn = new Map(
    (authUsers?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  );

  return NextResponse.json({
    agents: (agents ?? []).map((a) => ({ ...a, last_sign_in_at: lastSignIn.get(a.id) ?? null })),
  });
}

// -----------------------------------------------------------------------------

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageUsers(agent.role)) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, fullName, role } = parsed.data;
  const password = parsed.data.password ?? generatePassword();
  const generated = !parsed.data.password;

  const db = supabaseAdmin();

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // sem e-mail de confirmação: quem cria é o admin
    user_metadata: { full_name: fullName },
  });

  let userId = created?.user?.id ?? null;
  let reused = false;

  if (createError) {
    // A conta já existe no Auth compartilhado — provavelmente veio do dsearch.
    // Não é erro: é o caso de liberar o Chat para alguém que já tem login.
    // Nesse caminho a senha dela NÃO é tocada, senão quebraríamos o outro
    // sistema.
    const jaExiste =
      createError.message.toLowerCase().includes("already") ||
      (createError as { code?: string }).code === "email_exists";

    if (!jaExiste) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    const { data: lista } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = lista?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
    reused = true;

    if (!userId) {
      return NextResponse.json(
        { error: "O e-mail já existe no Auth, mas não consegui localizá-lo." },
        { status: 409 }
      );
    }
  }

  // O gatilho handle_new_user já criou a linha em chat.agents, inativa. Aqui
  // ela recebe papel e liberação — ou é criada, se a conta for antiga demais
  // para ter passado pelo gatilho.
  const { data: saved, error: upsertError } = await db
    .from("agents")
    .upsert(
      { id: userId, email, full_name: fullName, role, is_active: true },
      { onConflict: "id" }
    )
    .select("id, email, full_name, role, is_active, created_at")
    .single();

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 400 });
  }

  return NextResponse.json({
    agent: saved,
    reused,
    // Devolvida uma vez só: não fica guardada em lugar nenhum em texto claro.
    password: reused ? null : generated ? password : null,
  });
}
