/**
 * GET /api/knowledge/export — baixa a base como Markdown
 *
 * O arquivo carrega as próprias instruções de formato. A ideia é jogá-lo numa
 * LLM, pedir para ampliar, e reimportar — quem edita precisa das regras junto,
 * não num manual em outro lugar.
 */

import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageKnowledge } from "@/lib/roles";
import { serialize } from "@/lib/knowledge-file";

export async function GET() {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageKnowledge(agent.role)) {
    return new Response("Sem permissão para exportar a base.", { status: 403 });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("knowledge")
    .select("title, content, is_active")
    .order("position")
    .order("created_at");

  if (error) return new Response(error.message, { status: 500 });

  const texto = serialize(
    (data ?? []).map((s) => ({
      title: s.title,
      content: s.content,
      isActive: s.is_active,
    }))
  );

  const dia = new Date().toISOString().slice(0, 10);

  return new Response(texto, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="base-conhecimento-${dia}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
