/**
 * PATCH /api/channels/:id — renomeia, pausa, ou marca como padrão
 *
 * Pausar cala o que sai sozinho: o bot não responde e as campanhas não
 * disparam por este número. A conversa continua chegando e aparecendo no
 * painel, e quem estiver lá responde na mão — pausar é tirar o robô do ar,
 * não o cliente.
 *
 * O padrão é o canal que as campanhas usam quando ninguém escolhe. Um por
 * empresa, e sempre ativo: um padrão pausado devolveria a escolha ao acaso, que
 * foi como uma campanha inteira saiu pelo número desconectado. Quem troca é
 * `chat.definir_canal_padrao`, porque tirar de um e pôr no outro são duas
 * escritas que precisam andar juntas.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageChannels } from "@/lib/roles";

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    isActive: z.boolean().optional(),
    /** Só `true`: o padrão se troca marcando outro, nunca desmarcando este —
     *  ficar sem padrão nenhum devolveria a escolha ao acaso. */
    isDefault: z.literal(true).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.isActive !== undefined || v.isDefault !== undefined,
    { message: "Nada para alterar" }
  );

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  if (!canManageChannels(agent.role)) {
    return NextResponse.json({ error: "Só administradores mexem em canais." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Payload inválido" },
      { status: 400 }
    );
  }

  // O padrão vem primeiro e por função própria: ela recusa canal pausado e
  // tira o padrão do anterior na mesma transação.
  //
  // Com a sessão de quem clicou, e não com a chave de serviço: a função
  // pergunta `chat.is_manager()`, que lê `auth.uid()`. Pela chave de serviço
  // não há usuário nenhum, então ela recusava até o administrador — o papel
  // conferido logo acima nem chegava a ser consultado pelo banco.
  if (parsed.data.isDefault) {
    const supabase = await supabaseServer();
    const { error: padraoError } = await supabase.rpc("definir_canal_padrao", {
      p_channel_id: id,
    });
    if (padraoError) {
      // PT409 é a recusa desenhada: canal pausado não pode ser padrão.
      // 42501 é a do papel — não deveria acontecer, porque a rota já barrou
      // quem não é administrador, mas responder 500 esconderia o motivo.
      const status =
        padraoError.code === "PT409" ? 409 : padraoError.code === "42501" ? 403 : 500;
      return NextResponse.json({ error: padraoError.message }, { status });
    }
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;

  const devolver =
    "id, name, provider, instance_name, display_phone_number, " +
    "connection_state, connected_at, is_active, is_default";

  if (Object.keys(patch).length === 0) {
    const { data } = await supabaseAdmin()
      .from("channels").select(devolver).eq("id", id).maybeSingle();
    return NextResponse.json({ channel: data });
  }

  const { data, error } = await supabaseAdmin()
    .from("channels")
    .update(patch)
    .eq("id", id)
    .select(devolver)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Canal não encontrado" }, { status: 404 });

  return NextResponse.json({ channel: data });
}
