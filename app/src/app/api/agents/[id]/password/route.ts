/**
 * POST /api/agents/:id/password — define uma senha nova e manda pelo WhatsApp
 *
 * Vale para o Auth inteiro, não só para o Chat: se a pessoa também usa o
 * dsearch, a senha muda lá junto. A tela avisa antes de deixar clicar.
 *
 * Antes a senha aparecia na tela do administrador com um "anote agora". Isso
 * funciona enquanto as duas pessoas estão na mesma sala; fora disso a senha
 * atravessava o WhatsApp do administrador, ou um papel. Agora vai direto para
 * o número da pessoa — o e-mail deste Auth nunca foi configurado para sair,
 * então prometer entrega por e-mail seria prometer o que não acontece.
 *
 * A ordem aqui é o que importa: **primeiro se confere que dá para enviar,
 * depois se troca a senha**. Invertido, um canal fora do ar deixaria a pessoa
 * sem a senha velha e sem receber a nova.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageUsers } from "@/lib/roles";
import { credenciaisDoCanal, conexaoEvolution } from "@/lib/canais";
import { sendText } from "@/lib/evolution/client";

const schema = z.object({
  password: z.string().min(8, "A senha precisa de ao menos 8 caracteres").max(72).optional(),
});

function generatePassword(): string {
  const alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageUsers(agent.role)) {
    return NextResponse.json({ error: "Só administradores trocam senhas." }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: destino } = await db
    .from("agents")
    .select("id, full_name, email, whatsapp, company_id")
    .eq("id", id)
    .maybeSingle();

  if (!destino) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  if (!destino.whatsapp) {
    return NextResponse.json(
      {
        error:
          `${destino.full_name ?? "Esta pessoa"} não tem WhatsApp cadastrado. ` +
          `Preencha o número antes de gerar a senha — é para lá que ela vai.`,
      },
      { status: 400 }
    );
  }

  // O canal padrão é o primeiro a ser tentado: é justamente o que a empresa
  // marcou como "por onde as coisas saem". Não havendo, qualquer um conectado
  // serve — o que não serve é um canal fora do ar, e é por isso que a lista
  // exclui quem não está `open`.
  const { data: canais } = await db
    .from("channels")
    .select("id, name, is_default, connection_state")
    .eq("company_id", destino.company_id)
    .eq("is_active", true)
    .eq("connection_state", "open")
    .order("is_default", { ascending: false })
    .order("created_at");

  const canal = canais?.[0];
  if (!canal) {
    return NextResponse.json(
      {
        error:
          "Nenhum número conectado para enviar a senha. Conecte um canal em " +
          "Canais e tente de novo — a senha atual continua valendo até lá.",
      },
      { status: 409 }
    );
  }

  // Credenciais antes de mexer na senha, pelo mesmo motivo da checagem acima:
  // canal sem chave configurada falharia só na hora do envio.
  let conexao;
  let instancia: string;
  try {
    const cred = await credenciaisDoCanal(canal.id);
    if (cred.provider !== "evolution" || !cred.instanceName) {
      return NextResponse.json(
        { error: `O canal ${canal.name} não envia mensagem avulsa. Use um canal da Evolution.` },
        { status: 409 }
      );
    }
    conexao = conexaoEvolution(cred);
    instancia = cred.instanceName;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 409 }
    );
  }

  const password = parsed.data.password ?? generatePassword();

  const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Daqui para baixo a senha já mudou. Falha de envio não desfaz isso — e por
  // isso a senha volta na resposta: a tela mostra na mão o que o WhatsApp não
  // levou, em vez de deixar a pessoa trancada do lado de fora.
  const primeiroNome = (destino.full_name ?? "").trim().split(/\s+/)[0];
  const texto =
    `${primeiroNome ? `Oi, ${primeiroNome}. ` : ""}Sua senha do painel foi trocada.\n\n` +
    `Acesso: ${destino.email ?? "seu e-mail de cadastro"}\n` +
    `Senha: ${password}\n\n` +
    `Ela vale para o painel inteiro. Se não foi você quem pediu, avise o administrador.`;

  try {
    await sendText(conexao, instancia, destino.whatsapp, texto, { linkPreview: false });
  } catch (err) {
    console.error("[senha] troquei a senha mas não consegui enviar", err);
    return NextResponse.json({
      password,
      enviada: false,
      motivo: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ enviada: true, whatsapp: destino.whatsapp, canal: canal.name });
}
