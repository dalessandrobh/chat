/**
 * POST /api/knowledge/import — substitui a base pelo conteúdo de um arquivo
 *
 * Substitui, não mescla. Mesclar por título parece gentil e não é: renomear
 * uma seção no arquivo criaria uma cópia em vez de editar, e ninguém entende
 * por que a base dobrou de tamanho. Substituir é previsível, e o botão de
 * exportar existe justamente para haver uma cópia antes.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";
import { LIMITE_RECOMENDADO, parse } from "@/lib/knowledge-file";

const schema = z.object({
  content: z.string().min(1, "Arquivo vazio").max(400_000),
  /**
   * Importar tudo desligado. Padrão ligado, e é o que a tela recomenda:
   * arquivo que passou por uma LLM merece leitura antes de virar o que o
   * agente afirma ao cliente.
   */
  deactivateAll: z.boolean().optional(),
});

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) {
    return NextResponse.json({ error: "Sem permissão para importar." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { sections, avisos } = parse(parsed.data.content);

  if (sections.length === 0) {
    return NextResponse.json(
      {
        error:
          "Não encontrei nenhuma seção. Cada uma precisa começar com '## [ligada] Título'.",
      },
      { status: 400 }
    );
  }

  const desativarTudo = parsed.data.deactivateAll ?? true;
  const linhas = sections.map((s, i) => ({
    title: s.title,
    content: s.content.slice(0, 20000),
    position: (i + 1) * 10,
    is_active: desativarTudo ? false : s.isActive,
    updated_by: agent.id,
  }));

  const charsAtivos = linhas
    .filter((l) => l.is_active)
    .reduce((t, l) => t + l.title.length + l.content.length + 4, 0);

  if (charsAtivos > LIMITE_RECOMENDADO) {
    avisos.push(
      `A base ligada ficou com ${charsAtivos.toLocaleString("pt-BR")} caracteres, ` +
        `acima dos ${LIMITE_RECOMENDADO.toLocaleString("pt-BR")} recomendados. ` +
        `Isso encarece toda mensagem, não só as relacionadas.`
    );
  }

  // A troca inteira precisa ser atômica: se a inserção falhar depois do
  // delete, o cliente ficaria conversando com um agente sem base nenhuma.
  // O RPC faz as duas coisas na mesma transação.
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("replace_knowledge", { p_sections: linhas });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Recontagem a partir do banco, não do que achamos ter gravado.
  const { data: rendered } = await supabaseAdmin().rpc("render_knowledge");

  return NextResponse.json({
    importadas: linhas.length,
    ligadas: linhas.filter((l) => l.is_active).length,
    avisos,
    chars: (rendered as string | null)?.length ?? 0,
  });
}
