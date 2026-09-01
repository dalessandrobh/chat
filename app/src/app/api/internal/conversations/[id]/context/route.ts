/**
 * GET /api/internal/conversations/:id/context
 *
 * O que o agente precisa saber antes de responder: quem é a pessoa, em que
 * estado está a conversa e o que já foi dito.
 *
 * Por que não usar a memória do n8n: ela guardaria só o que passou pelo
 * workflow. Ficariam de fora as mensagens que o dono digita no próprio
 * celular — que é justamente o que ganhamos ao usar a Evolution. O agente
 * responderia como se aquela conversa não tivesse acontecido, repetindo o que
 * o dono já respondeu na mão. A memória de verdade é chat.messages.
 */

import { NextResponse } from "next/server";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { faltandoTexto, lerQualificacao, registrarTentativa } from "@/lib/qualificacao";

/** Teto de mensagens no contexto. Conversa de WhatsApp é longa e picotada;
 *  as 40 últimas cobrem o assunto atual sem inflar o prompt. */
const LIMITE = 40;

const ROTULO = {
  contact: "Cliente",
  bot: "Atendimento",
  agent: "Atendimento",
  system: "Sistema",
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: conversation } = await db
    .from("conversations")
    .select(
      "id, mode, status, window_expires_at, contact_id, company_id, companies(name), contacts(wa_id, profile_name, display_name, tags, metadata), channels(provider, name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  // A base vai junto do contexto de propósito: o workflow já faz esta
  // chamada, então a base chega ao agente sem mexer no desenho do fluxo.
  //
  // A empresa vem da conversa. Esta rota roda com chave de serviço, que ignora
  // a RLS: sem o parâmetro, o prompt sairia com a base de todas as empresas
  // juntas — e o agente de uma responderia com o preço da outra.
  const { data: base } = await db.rpc("render_knowledge", {
    p_company_id: conversation.company_id,
  });

  const { data: messages } = await db
    .from("messages")
    .select("direction, author, type, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  // Vieram do mais novo para o mais velho, para o limite pegar o fim da
  // conversa; o agente lê na ordem natural.
  const historico = (messages ?? []).reverse();

  const contact = conversation.contacts as unknown as {
    wa_id: string;
    profile_name: string | null;
    display_name: string | null;
    tags: string[];
    metadata: Record<string, unknown> | null;
  } | null;

  let qualificacao = lerQualificacao(contact?.metadata);

  // Servir o contexto é o momento em que a pergunta do topo da fila vai ser
  // feita, então é aqui que ela conta como tentativa. Só em modo bot: com um
  // humano na conversa ninguém está perguntando nada em nome do agente.
  if (conversation.mode === "bot") {
    const depois = registrarTentativa(qualificacao);
    if (depois !== qualificacao) {
      qualificacao = depois;
      await db
        .from("contacts")
        .update({ metadata: { ...(contact?.metadata ?? {}), qualificacao } })
        .eq("id", conversation.contact_id);
    }
  }

  const empresa =
    (conversation.companies as unknown as { name: string } | null)?.name ?? "";

  return NextResponse.json({
    conversationId: conversation.id,
    /**
     * Nome da empresa dona da conversa. O prompt do agente monta a primeira
     * frase com isto em vez de trazer o nome cravado: um nome fixo no prompt
     * faria o cliente de uma empresa ser atendido em nome de outra.
     */
    empresa,
    /** Base de conhecimento ativa, já montada. Vazia enquanto ninguém ligar
     *  nenhuma seção — e aí o agente segue só com as regras do prompt. */
    base: (base as string | null) ?? "",
    /** O workflow checa isto antes de responder: em `human` ele não fala. */
    mode: conversation.mode,
    status: conversation.status,
    contact: {
      waId: contact?.wa_id ?? null,
      name: contact?.display_name ?? contact?.profile_name ?? null,
      tags: contact?.tags ?? [],
    },
    /** O que já foi apurado sobre esta pessoa, de conversas anteriores inclusive. */
    qualificacao,
    /** A fila de perguntas que sobrou, pronta para o prompt. Vazia quando não
     *  falta nada — e aí o agente para de perguntar, sem depender de lembrar
     *  o que perguntou. */
    faltando: faltandoTexto(qualificacao),
    messages: historico.map((m) => ({
      de: ROTULO[m.author as keyof typeof ROTULO] ?? m.author,
      tipo: m.type,
      texto: m.body,
      em: m.created_at,
    })),
    /** Transcrição pronta para colar no prompt, que é como o agente usa. */
    transcricao: historico
      .map((m) => {
        const quem = ROTULO[m.author as keyof typeof ROTULO] ?? m.author;
        const texto = m.body ?? `(${m.type})`;
        return `${quem}: ${texto}`;
      })
      .join("\n"),
  });
}
