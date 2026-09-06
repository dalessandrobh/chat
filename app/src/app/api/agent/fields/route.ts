/**
 * GET  /api/agent/fields — a fila de perguntas da qualificação
 * POST /api/agent/fields — cria uma pergunta
 *
 * O que a equipe precisa saber antes de assumir a conversa. Era uma lista
 * cravada em TypeScript, escrita para revendedora de aquecedor solar; agora é
 * cadastro, porque é isto que faz o mesmo bot perguntar "quantas pessoas usam
 * o chuveiro" numa empresa e "qual o modelo do carro" na outra.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";
import {
  COLUNAS,
  chaveSchema,
  normalizarDependencia,
  regexInvalida,
} from "@/lib/campos-qualificacao";

const createSchema = z.object({
  chave: chaveSchema,
  pergunta: z.string().trim().min(3, "Escreva a pergunta").max(200),
  tipo: z.enum(["texto", "numero"]).default("texto"),
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

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("qualification_fields")
    .select(COLUNAS)
    .order("position")
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ fields: data ?? [] });
}

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payload inválido" }, { status: 400 });
  }

  const d = parsed.data;
  const dependencia = normalizarDependencia(d.dependeDe, d.dependeValor);
  const erroRegex = regexInvalida(dependencia.depende_valor);
  if (erroRegex) return NextResponse.json({ error: erroRegex }, { status: 400 });

  // Depender de si mesma trava a pergunta para sempre: ela só entraria na
  // fila depois de respondida.
  if (dependencia.depende_de === d.chave) {
    return NextResponse.json(
      { error: "A pergunta não pode depender dela mesma" },
      { status: 400 }
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("qualification_fields")
    .insert({
      company_id: agent.company_id,
      chave: d.chave,
      pergunta: d.pergunta,
      tipo: d.tipo,
      // No fim da fila: pergunta nova raramente é a primeira coisa a
      // perguntar, e mudar a ordem é um arrastar de posição depois.
      position: d.position ?? 100,
      is_active: d.isActive ?? true,
      ...dependencia,
      updated_by: agent.id,
    })
    .select(COLUNAS)
    .single();

  if (error) {
    const duplicada = error.code === "23505";
    return NextResponse.json(
      { error: duplicada ? "Já existe uma pergunta com essa chave" : error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({ field: data });
}
