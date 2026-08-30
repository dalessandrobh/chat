/**
 * POST /api/agents/:id/password — define uma senha nova
 *
 * Vale para o Auth inteiro, não só para o Chat: se a pessoa também usa o
 * dsearch, a senha muda lá junto. A tela avisa antes de deixar clicar.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageUsers } from "@/lib/roles";

const schema = z.object({
  password: z.string().min(8, "A senha precisa de ao menos 8 caracteres").max(72).optional(),
});

function generatePassword(): string {
  const alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageUsers(agent.role)) {
    return NextResponse.json({ error: "Só administradores trocam senhas." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const password = parsed.data.password ?? generatePassword();

  const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ password });
}
