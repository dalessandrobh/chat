/**
 * POST /api/internal/conversations/:id/qualification
 *
 * O agente grava aqui o que apurou. O que entra nesta rota sai da fila de
 * perguntas que o contexto devolve no turno seguinte — é isso que impede o
 * bot de perguntar a mesma coisa de novo.
 *
 * Quais campos existem é da empresa, não desta rota: eles vêm de
 * `chat.qualification_fields`. A ferramenta do n8n é uma só para todas, então
 * ela manda um objeto `dados` com as chaves que o prompt daquela empresa
 * listou — e o que não estiver cadastrado é descartado aqui, calado. Modelo
 * inventa chave; dado inventado no metadata do contato ninguém descobre
 * depois.
 *
 * Guardamos no contato, não na conversa: a pessoa some por um mês, volta, e a
 * cidade dela continua sendo a mesma.
 *
 * A mesma rota recebe `lembrar`, que é o que a pessoa contou de si e não cabe
 * em campo cadastrado — preferência, contexto, o que aconteceu da última vez.
 * Vem junto e não numa ferramenta própria porque é o mesmo gesto do agente
 * ("descobri algo sobre esta pessoa") e porque cada ferramenta a mais é uma
 * chance a mais de o modelo chamar a errada.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { camposDaEmpresa } from "@/lib/diretrizes";
import {
  faltando,
  lerQualificacao,
  type Campo,
  type Qualificacao,
} from "@/lib/qualificacao";
import { gravarFatos, limparFatos } from "@/lib/memoria";

/**
 * Modelo de linguagem manda campo vazio com frequência — string em branco,
 * "null", "não informado" — querendo dizer "não sei". Nada disso pode virar
 * dado gravado, senão a pergunta sai da fila sem ter sido respondida.
 */
function vazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v !== "string") return false;
  return /^\s*(|null|undefined|n\/a|não informado|nao informado|-)\s*$/i.test(v);
}

const bodySchema = z.object({
  /** O objeto com as respostas: `{"cidade":"Belo Horizonte","pessoas":4}`.
   *  Chega como texto quando o modelo prefere mandar JSON numa string. */
  dados: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  /** Aceita "cidade,pessoas" ou ["cidade","pessoas"]: o modelo usa as duas formas. */
  dispensados: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * O que a pessoa contou de si e não é campo cadastrado. Uma frase por item;
   * texto com quebras de linha vira várias. O teto e a limpeza são de
   * `lib/memoria.ts`, porque modelo manda parágrafo onde se pediu frase.
   */
  lembrar: z.union([z.string(), z.array(z.string())]).optional(),
});

/** `dados` como objeto, venha ele como objeto ou como JSON dentro de string. */
function lerDados(bruto: unknown): Record<string, unknown> {
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    return bruto as Record<string, unknown>;
  }
  if (typeof bruto === "string") {
    try {
      const parsed = JSON.parse(bruto);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // JSON quebrado é o mesmo que não ter mandado nada: a pergunta continua
      // na fila e o agente pergunta de novo no turno seguinte.
    }
  }
  return {};
}

/** Converte a resposta para o tipo do campo, ou devolve undefined quando ela
 *  não serve. Texto onde se espera conta — "umas quatro" — é dado sujo, e
 *  quem lê depois não tem como saber que era um palpite. */
function converter(campo: Campo, valor: unknown): string | number | undefined {
  if (vazio(valor)) return undefined;

  if (campo.tipo === "numero") {
    const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
    if (!Number.isFinite(n)) return undefined;
    const inteiro = Math.round(n);
    if (inteiro < 0 || inteiro > 1_000_000) return undefined;
    return inteiro;
  }

  const texto = String(valor).trim();
  if (texto.length === 0) return undefined;
  return texto.slice(0, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: conversation } = await db
    .from("conversations")
    .select("contact_id, company_id, contacts(metadata, display_name)")
    .eq("id", id)
    .maybeSingle();

  if (!conversation?.contact_id) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const campos = await camposDaEmpresa(conversation.company_id);

  const contact = conversation.contacts as unknown as {
    metadata: Record<string, unknown> | null;
    display_name: string | null;
  } | null;

  const anterior = lerQualificacao(contact?.metadata);

  // O objeto `dados` é o caminho oficial. As chaves soltas na raiz ficam
  // aceitas porque o modelo às vezes manda assim, e recusar por causa da
  // forma perderia o dado que ele acabou de apurar.
  const raiz = (corpo ?? {}) as Record<string, unknown>;
  const dados = { ...raiz, ...lerDados(parsed.data.dados) };

  const novos: Record<string, string | number> = {};
  for (const campo of campos) {
    const valor = converter(campo, dados[campo.chave]);
    if (valor !== undefined) novos[campo.chave] = valor;
  }

  const cadastradas = new Set(campos.map((c) => c.chave));
  const recusados = new Set(anterior.dispensados ?? []);
  const { dispensados } = parsed.data;
  const lista = Array.isArray(dispensados) ? dispensados : (dispensados ?? "").split(",");
  for (const item of lista) {
    const chave = item.trim().toLowerCase();
    if (cadastradas.has(chave)) recusados.add(chave);
  }

  const qualificacao: Qualificacao = {
    ...anterior,
    // Valor novo vence o antigo: a pessoa pode se corrigir no meio da conversa.
    ...novos,
    ...(recusados.size > 0 && { dispensados: [...recusados] }),
    atualizado_em: new Date().toISOString(),
  };

  const nome = typeof novos.nome === "string" ? novos.nome : null;

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

  // Depois da qualificação, e nunca antes: memória é ganho, qualificação é o
  // combinado. Falha ao gravar fato não pode custar a resposta desta rota, e é
  // por isso que `gravarFatos` engole o próprio erro em vez de estourar.
  const lembrados = await gravarFatos({
    contactId: conversation.contact_id,
    companyId: conversation.company_id,
    conversationId: id,
    fatos: limparFatos(parsed.data.lembrar),
  });

  const pendentes = faltando(qualificacao, campos);

  // A resposta volta para o agente no mesmo turno: ele já sabe o que sobrou
  // sem esperar a próxima mensagem do cliente.
  return NextResponse.json({
    ok: true,
    anotado: Object.keys(novos),
    /** O que o agente mandou e não está cadastrado. Vai na resposta em vez de
     *  sumir: é assim que se descobre que o prompt e a fila divergiram. */
    ignorado: Object.keys(dados).filter(
      (chave) =>
        chave !== "dados" &&
        chave !== "dispensados" &&
        chave !== "lembrar" &&
        !cadastradas.has(chave)
    ),
    /** O que virou memória do contato. Repetido não aparece: já se sabia. */
    lembrado: lembrados,
    falta: pendentes.map((campo) => `${campo.chave} — ${campo.pergunta}`),
    qualificacaoCompleta: pendentes.length === 0,
  });
}
