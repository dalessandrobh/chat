/**
 * GET /api/agent/profile — as diretrizes de atendimento da empresa
 * PUT /api/agent/profile — grava as diretrizes
 *
 * Camada 2 das três que formam o prompt: as regras da plataforma são fixas e
 * moram no n8n, a base de conhecimento é o que o bot sabe, e isto aqui é como
 * ele se comporta — tom, o que nunca dizer, quando chamar alguém.
 *
 * Campos delimitados, e não um prompt em branco, de propósito: quem escreve o
 * próprio prompt apaga sem querer as linhas que impedem o bot de inventar
 * preço. O campo livre existe, tem teto e entra no fim.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";
import { FUSOS, HORA, type HorarioSemana } from "@/lib/horario-semana";

const COLUNAS =
  "apresentacao, tom, pode_explicar, nunca_dizer, quando_escalar, horario_semana, fuso, regiao, observacoes, updated_at";

/**
 * O horário é a única parte do perfil que a máquina lê, não só o modelo: é
 * dele que sai a decisão de avisar o cliente de que a equipe só volta amanhã.
 * Por isso são campos, e não a frase solta que existia antes.
 */
const faixaSchema = z
  .object({ abre: z.string().regex(HORA), fecha: z.string().regex(HORA) })
  .refine((f) => f.fecha > f.abre, { message: "O fim do expediente precisa vir depois do início" });

const horarioSchema = z
  .record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), faixaSchema)
  .default({});

/** Os mesmos tetos do banco. Aqui eles viram mensagem em português; lá são a
 *  garantia de que nenhum outro caminho grava um prompt de 40 mil caracteres. */
const putSchema = z.object({
  apresentacao: z.string().trim().max(1000).default(""),
  tom: z.enum(["informal", "neutro", "formal"]).default("neutro"),
  podeExplicar: z.string().trim().max(1000).default(""),
  nuncaDizer: z.string().trim().max(1000).default(""),
  quandoEscalar: z.string().trim().max(1000).default(""),
  horarioSemana: horarioSchema,
  fuso: z.enum(FUSOS.map((f) => f.valor) as [string, ...string[]]).default("America/Sao_Paulo"),
  regiao: z.string().trim().max(300).default(""),
  observacoes: z.string().trim().max(2000).default(""),
});

type Linha = {
  apresentacao: string;
  tom: string;
  pode_explicar: string;
  nunca_dizer: string;
  quando_escalar: string;
  horario_semana: HorarioSemana;
  fuso: string;
  regiao: string;
  observacoes: string;
  updated_at: string | null;
};

const vazio: Linha = {
  apresentacao: "",
  tom: "neutro",
  pode_explicar: "",
  nunca_dizer: "",
  quando_escalar: "",
  horario_semana: {},
  fuso: "America/Sao_Paulo",
  regiao: "",
  observacoes: "",
  updated_at: null,
};

function paraTela(linha: Linha, rendered: string) {
  return {
    perfil: {
      apresentacao: linha.apresentacao,
      tom: linha.tom,
      podeExplicar: linha.pode_explicar,
      nuncaDizer: linha.nunca_dizer,
      quandoEscalar: linha.quando_escalar,
      horarioSemana: linha.horario_semana ?? {},
      fuso: linha.fuso || "America/Sao_Paulo",
      regiao: linha.regiao,
      observacoes: linha.observacoes,
      atualizadoEm: linha.updated_at,
    },
    /** O texto que o agente vai receber, montado pela mesma função que ele usa. */
    rendered,
  };
}

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("company_profile").select(COLUNAS).maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: rendered } = await supabase.rpc("render_company_profile", {
    p_company_id: agent.company_id,
  });

  // Empresa criada antes desta tela não tem linha, e isso não é erro: é o
  // perfil em branco, que a tela mostra como formulário vazio.
  return NextResponse.json(
    paraTela((data as Linha | null) ?? vazio, (rendered as string | null) ?? "")
  );
}

export async function PUT(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  if (!canManageKnowledge(agent.role)) {
    return NextResponse.json(
      { error: "Só gestores e administradores mudam as diretrizes." },
      { status: 403 }
    );
  }

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const supabase = await supabaseServer();

  // Upsert, não update: empresa que nunca abriu esta tela não tem linha, e um
  // update mudaria zero linhas em silêncio — a tela diria "salvo" e nada teria
  // mudado.
  const { error } = await supabase.from("company_profile").upsert(
    {
      company_id: agent.company_id,
      apresentacao: d.apresentacao,
      tom: d.tom,
      pode_explicar: d.podeExplicar,
      nunca_dizer: d.nuncaDizer,
      quando_escalar: d.quandoEscalar,
      horario_semana: d.horarioSemana,
      fuso: d.fuso,
      regiao: d.regiao,
      observacoes: d.observacoes,
      updated_by: agent.id,
    },
    { onConflict: "company_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: rendered } = await supabase.rpc("render_company_profile", {
    p_company_id: agent.company_id,
  });

  return NextResponse.json({ ok: true, rendered: (rendered as string | null) ?? "" });
}
