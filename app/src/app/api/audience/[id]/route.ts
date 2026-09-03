/**
 * PATCH  /api/audience/:id — corrige o cadastro, ou devolve à lista de envio
 * DELETE /api/audience/:id — apaga a linha
 *
 * Apagar de verdade é novidade nesta tabela e continua sendo a exceção: a
 * marca `is_sendable = false` existe justamente para que a linha fique como
 * prova de que aquele número pediu para sair. Por isso quem pediu para sair
 * só sai da base com um `confirmo` explícito, e devolvê-lo à lista também.
 *
 * A empresa nunca aparece nos filtros daqui: a RLS já recorta por
 * `chat.current_company()`, então o id de outra empresa simplesmente não
 * existe para esta sessão — e 404 é a resposta certa para ele.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";
import { EXIGE_CONFIRMACAO, MOTIVO_FORA } from "@/lib/base-envio";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  waId: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{7,14}$/, "Número em E.164 sem símbolos, ex.: 5531999998888")
    .optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Tira a marca de fora da lista. Exige `confirmo`. */
  reativar: z.boolean().optional(),
  confirmo: z.boolean().optional(),
});

function forbidden() {
  return NextResponse.json({ error: "Sem permissão para editar a base de envio." }, { status: 403 });
}

function naoEncontrado() {
  return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
}

/** Precisa de mais um clique, e a tela precisa saber por quê. */
function pedeConfirmacao(motivo: string, texto: string) {
  return NextResponse.json({ error: texto, exigeConfirmacao: true, motivo }, { status: 409 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return forbidden();

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { name, waId, tags, reativar, confirmo } = parsed.data;

  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: atual } = await supabase
    .from("audience")
    .select("id, is_sendable, unsendable_reason, notes")
    .eq("id", id)
    .maybeSingle();
  if (!atual) return naoEncontrado();

  const mudanca: Record<string, unknown> = {};
  if (name !== undefined) mudanca.name = name;
  if (waId !== undefined) mudanca.wa_id = waId;
  if (tags !== undefined) mudanca.tags = tags;

  if (reativar && !atual.is_sendable) {
    if (!confirmo) {
      return pedeConfirmacao(
        atual.unsendable_reason ?? "manual",
        atual.unsendable_reason === EXIGE_CONFIRMACAO
          ? "Este contato pediu para não receber mensagens. Confirme para devolvê-lo à lista."
          : "Confirme para devolver este contato à lista de envio."
      );
    }
    // O constraint da tabela exige os três coerentes: voltar à lista limpa o
    // motivo. Como isso apaga a única evidência estruturada de que a pessoa
    // pediu para sair, o motivo desce para as anotações antes de sumir.
    mudanca.is_sendable = true;
    mudanca.unsendable_reason = null;
    mudanca.unsendable_at = null;
    const carimbo =
      `${new Date().toISOString().slice(0, 10)} — devolvido à lista por ` +
      `${agent.full_name ?? "um gestor"} (estava fora: ` +
      `${MOTIVO_FORA[atual.unsendable_reason ?? ""] ?? atual.unsendable_reason})`;
    mudanca.notes = [atual.notes, carimbo].filter(Boolean).join("\n");
  }

  if (Object.keys(mudanca).length === 0) {
    return NextResponse.json({ error: "Nada para mudar." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("audience")
    .update(mudanca)
    .eq("id", id)
    .select("id, name, wa_id, tags, is_sendable, unsendable_reason, unsendable_at")
    .maybeSingle();

  if (error) {
    // 23505 = já existe outro contato com esse número na empresa.
    const texto =
      error.code === "23505"
        ? "Já existe um contato com esse número na base."
        : error.message;
    return NextResponse.json({ error: texto }, { status: 400 });
  }
  if (!data) return naoEncontrado();

  return NextResponse.json({ contato: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) return forbidden();

  const { id } = await params;
  const confirmo = new URL(request.url).searchParams.get("confirmo") === "1";
  const supabase = await supabaseServer();

  const { data: atual } = await supabase
    .from("audience")
    .select("id, name, is_sendable, unsendable_reason")
    .eq("id", id)
    .maybeSingle();
  if (!atual) return naoEncontrado();

  if (!atual.is_sendable && atual.unsendable_reason === EXIGE_CONFIRMACAO && !confirmo) {
    return pedeConfirmacao(
      EXIGE_CONFIRMACAO,
      `${atual.name} pediu para não receber mensagens. Apagar a linha apaga esse ` +
        `registro, e nada impede que o número volte na próxima planilha. Confirme para apagar.`
    );
  }

  const { error } = await supabase.from("audience").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ apagados: 1 });
}
