/**
 * POST /api/internal/escalate
 * O bot passa a conversa para a fila humana.
 *
 * Usado quando o workflow detecta "quero falar com um atendente", ou quando
 * cai no fallback por não entender o pedido. Diferente de take_over(), aqui
 * não há agente logado: a conversa vai para `pending`, sem dono, e aparece
 * destacada no painel.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServiceToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/messages";
import {
  horarioAgora,
  avisoForaDoHorario,
  filaForaDoExpediente,
  avisoJaDado,
} from "@/lib/horario";

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  /**
   * Última fala do bot, entregue ANTES de a conversa virar humana.
   *
   * Sem isto o cliente fica no vácuo: o bot escala, o modo vira `human`, e a
   * despedida que ele tentaria mandar depois esbarra na própria trava de
   * handoff e volta 409. A ordem importa, então o envio mora aqui dentro.
   */
  message: z.string().max(1000).optional(),
});

export async function POST(request: Request) {
  if (!hasServiceToken(request)) {
    return NextResponse.json({ error: "Token de serviço inválido" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { conversationId, reason, message } = parsed.data;

  // A empresa vem da própria conversa. Esta rota roda com chave de serviço,
  // que ignora a RLS: aceitar a empresa do corpo do pedido seria deixar quem
  // chama escolher em nome de quem age.
  const { data: before } = await db
    .from("conversations")
    .select("mode, company_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!before) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  // Já está com humano: não há transferência a fazer, e repetir o evento só
  // poluiria a auditoria. Mas ainda pode haver o que dizer.
  const jaNaFila = before.mode === "human";

  // Com um atendente na conversa, ou com a empresa aberta, a fila é de gente e
  // o bot não fala: sai calado, como sempre saiu.
  if (jaNaFila && !(await filaForaDoExpediente(conversationId))) {
    return NextResponse.json({ ok: true, alreadyHuman: true });
  }

  // Fora do expediente, "vou chamar uma pessoa" é uma promessa que só vence
  // amanhã. Quem sabe a hora é o servidor — o modelo não sabe, e é por isso
  // que o aviso é acrescentado aqui e não escrito por ele.
  //
  // O complemento vale mesmo sem `message`: a escalada por mídia ilegível já
  // mandou "estou chamando uma pessoa" antes de chegar nesta rota, e é
  // justamente essa a frase que precisa de ressalva às onze da noite.
  //
  // Quem já está na fila pode já ter ouvido o aviso nesta mesma espera. Aí ele
  // não se repete: o que interessa agora é o `message`, que responde ao que a
  // pessoa acabou de mandar.
  const aviso =
    jaNaFila && (await avisoJaDado(conversationId))
      ? null
      : avisoForaDoHorario(await horarioAgora(before.company_id));

  const despedida = [message, aviso].filter(Boolean).join("\n\n");

  // Falar primeiro, transferir depois. Se o envio falhar, a transferência
  // acontece do mesmo jeito: é pior deixar a conversa presa no bot do que
  // deixá-la sem a mensagem de despedida.
  if (despedida) {
    const enviada = await sendTextMessage({
      conversationId,
      text: despedida,
      author: "bot",
    });
    if (!enviada.ok) {
      console.error(`[escalate] despedida não enviada: ${enviada.message}`);
    }
  }

  // A conversa já estava na fila: falar era tudo o que faltava.
  if (jaNaFila) {
    return NextResponse.json({ ok: true, alreadyHuman: true });
  }

  const { error } = await db
    .from("conversations")
    .update({
      mode: "human",
      status: "pending",
      assigned_agent_id: null,
      bot_resume_at: null,
    })
    .eq("id", conversationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from("handoff_events").insert({
    conversation_id: conversationId,
    from_mode: "bot",
    to_mode: "human",
    actor: "bot",
    reason: reason ?? "Escalado pela automação",
    company_id: before.company_id,
  });

  return NextResponse.json({ ok: true });
}
