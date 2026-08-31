/**
 * POST /api/internal/conversations/:id/qualification
 *
 * O agente grava aqui o que apurou: nome, cidade, uso e número de pessoas.
 * O que entra nesta rota sai da fila de perguntas que o contexto devolve no
 * turno seguinte — é isso que impede o bot de perguntar a mesma coisa de novo.
 *
 * Guardamos no contato, não na conversa: a pessoa some por um mês, volta, e a
 * cidade dela continua sendo a mesma.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  CHAVES,
  faltando,
  lerQualificacao,
  type CampoQualificacao,
  type Qualificacao,
} from "@/lib/qualificacao";

/**
 * Modelo de linguagem manda campo vazio com frequência — string em branco,
 * "null", "não informado" — querendo dizer "não sei". Nada disso pode virar
 * dado gravado, senão a pergunta sai da fila sem ter sido respondida.
 */
const vazio = (v: unknown) =>
  typeof v === "string" && /^\s*(|null|undefined|n\/a|não informado|nao informado|-)\s*$/i.test(v)
    ? undefined
    : v;

const texto = (max: number) => z.preprocess(vazio, z.string().trim().min(1).max(max).optional());

const bodySchema = z.object({
  nome: texto(120),
  cidade: texto(120),
  uso: texto(60),
  pessoas: z.preprocess(vazio, z.coerce.number().int().min(1).max(99).optional()),
  /** Aceita "cidade,pessoas" ou ["cidade","pessoas"]: o modelo usa as duas formas. */
  dispensados: z.preprocess(vazio, z.union([z.string(), z.array(z.string())]).optional()),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: conversation } = await db
    .from("conversations")
    .select("contact_id, contacts(metadata, display_name)")
    .eq("id", id)
    .maybeSingle();

  if (!conversation?.contact_id) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const contact = conversation.contacts as unknown as {
    metadata: Record<string, unknown> | null;
    display_name: string | null;
  } | null;

  const anterior = lerQualificacao(contact?.metadata);
  const { nome, cidade, uso, pessoas, dispensados } = parsed.data;

  const recusados = new Set(anterior.dispensados ?? []);
  const lista = Array.isArray(dispensados) ? dispensados : (dispensados ?? "").split(",");
  for (const item of lista) {
    const chave = item.trim().toLowerCase() as CampoQualificacao;
    if (CHAVES.includes(chave)) recusados.add(chave);
  }

  const qualificacao: Qualificacao = {
    ...anterior,
    // Valor novo vence o antigo: a pessoa pode se corrigir no meio da conversa.
    ...(nome !== undefined && { nome }),
    ...(cidade !== undefined && { cidade }),
    ...(uso !== undefined && { uso }),
    ...(pessoas !== undefined && { pessoas }),
    ...(recusados.size > 0 && { dispensados: [...recusados] }),
    atualizado_em: new Date().toISOString(),
  };

  const anotado = (["nome", "cidade", "uso", "pessoas"] as const).filter(
    (chave) => parsed.data[chave] !== undefined
  );

  const { error } = await db
    .from("contacts")
    .update({
      metadata: { ...(contact?.metadata ?? {}), qualificacao },
      // O nome que a pessoa disse vale mais no painel do que o do perfil do
      // WhatsApp, mas nunca por cima do que um atendente digitou à mão.
      ...(nome && !contact?.display_name && { display_name: nome }),
    })
    .eq("id", conversation.contact_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pendentes = faltando(qualificacao);

  // A resposta volta para o agente no mesmo turno: ele já sabe o que sobrou
  // sem esperar a próxima mensagem do cliente.
  return NextResponse.json({
    ok: true,
    anotado,
    falta: pendentes.map((campo) => campo.pergunta),
    qualificacaoCompleta: pendentes.length === 0,
  });
}
