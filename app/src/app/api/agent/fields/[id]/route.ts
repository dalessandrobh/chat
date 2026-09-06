/**
 * PATCH  /api/agent/fields/:id — edita, reordena ou liga/desliga uma pergunta
 * DELETE /api/agent/fields/:id — remove
 *
 * A chave não muda por aqui, e não é esquecimento: ela é o nome do dado
 * dentro de `contacts.metadata.qualificacao`. Renomear faria toda resposta já
 * gravada virar órfã, e a pergunta voltaria à fila de gente que já tinha
 * respondido. Quem precisa de outra chave cria outra pergunta.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";
import { COLUNAS, normalizarDependencia, regexInvalida } from "@/lib/campos-qualificacao";

const patchSchema = z.object({
  pergunta: z.string().trim().min(3).max(200).optional(),
  tipo: z.enum(["texto", "numero"]).optional(),
  position: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  dependeDe: z.string().trim().optional().nullable(),
  dependeValor: z.string().trim().max(200).optional().nullable(),
});

function forbidden() {
  return NextResponse.json(
    { error: "Só gestores e administradores mudam a qualificação." },
    { status: 403 }
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) return forbidden();

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payload inválido" }, { status: 400 });
  }

  const { pergunta, tipo, position, isActive, dependeDe, dependeValor } = parsed.data;
  const patch: Record<string, unknown> = { updated_by: agent.id };
  if (pergunta !== undefined) patch.pergunta = pergunta;
  if (tipo !== undefined) patch.tipo = tipo;
  if (position !== undefined) patch.position = position;
  if (isActive !== undefined) patch.is_active = isActive;

  // Os dois lados da dependência andam juntos, então ela é reescrita inteira
  // sempre que qualquer um dos dois vier.
  if (dependeDe !== undefined || dependeValor !== undefined) {
    const dependencia = normalizarDependencia(dependeDe, dependeValor);
    const erroRegex = regexInvalida(dependencia.depende_valor);
    if (erroRegex) return NextResponse.json({ error: erroRegex }, { status: 400 });
    Object.assign(patch, dependencia);
  }

  const supabase = await supabaseServer();

  // A chave vem do banco porque ela não é editável: conferir antes de gravar
  // evita salvar uma dependência circular e só então reclamar dela.
  const { data: atual } = await supabase
    .from("qualification_fields")
    .select("chave")
    .eq("id", id)
    .maybeSingle();

  if (!atual) {
    return NextResponse.json({ error: "Pergunta não encontrada" }, { status: 404 });
  }

  if (patch.depende_de === atual.chave) {
    return NextResponse.json(
      { error: "A pergunta não pode depender dela mesma" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("qualification_fields")
    .update(patch)
    .eq("id", id)
    .select(COLUNAS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ field: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) return forbidden();

  const { id } = await params;
  const supabase = await supabaseServer();

  // O que já foi respondido continua gravado no contato: apagar a pergunta
  // tira ela da fila, não apaga o histórico de quem já respondeu.
  const { error } = await supabase.from("qualification_fields").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
