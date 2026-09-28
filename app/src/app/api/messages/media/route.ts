/**
 * POST /api/messages/media — sobe o arquivo que o atendente vai mandar
 *
 * O arquivo vai para o bucket **privado** `conversas` e volta em duas formas:
 * o caminho, que fica guardado na mensagem e serve para reabrir o anexo
 * depois, e uma URL assinada curta, que é o que a Evolution usa para baixar
 * uma vez na hora do envio.
 *
 * Público seria mais simples — é o que as campanhas fazem —, mas ali o arquivo
 * é peça de marketing e aqui é conteúdo de cliente: a foto do telhado da casa
 * de alguém não pode virar endereço eterno que abre sem senha.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";
import { LIMITE_BYTES, tipoDeMidia } from "@/lib/midia-enviada";

/**
 * Quanto tempo a URL fica de pé.
 *
 * É o intervalo entre o upload e o download da Evolution, que acontece em
 * segundos. Minutos dão folga para um envio lento sem transformar o link num
 * endereço que vaza.
 */
const VALIDADE_SEGUNDOS = 600;

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const form = await request.formData();
  const file = form.get("file");
  const conversationId = String(form.get("conversationId") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo recebido." }, { status: 400 });
  }

  // A conversa é lida pela sessão de quem pediu: a RLS já recusa a de outra
  // empresa, e sem ela o caminho do arquivo poderia ser escolhido por quem
  // chamasse a rota.
  const supabase = await supabaseServer();
  const { data: conversa } = await supabase
    .from("conversations")
    .select("id, company_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversa) {
    return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  }

  const kind = tipoDeMidia(file.type);
  if (!kind) {
    return NextResponse.json(
      { error: `O WhatsApp não aceita arquivos ${file.type || "deste tipo"}.` },
      { status: 400 }
    );
  }
  if (file.size > LIMITE_BYTES) {
    return NextResponse.json(
      {
        error: `Arquivo de ${(file.size / 1e6).toFixed(1)} MB. O WhatsApp recusa acima de ${
          LIMITE_BYTES / 1e6
        } MB.`,
      },
      { status: 400 }
    );
  }

  const extensao = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const caminho = `${conversa.company_id}/${conversa.id}/${crypto.randomUUID()}.${extensao}`;

  const db = supabaseAdmin();
  const { error } = await db.storage
    .from("conversas")
    .upload(caminho, file, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: assinada, error: erroUrl } = await db.storage
    .from("conversas")
    .createSignedUrl(caminho, VALIDADE_SEGUNDOS);

  if (erroUrl || !assinada) {
    return NextResponse.json(
      { error: erroUrl?.message ?? "Não consegui gerar o link do arquivo." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    storagePath: caminho,
    url: assinada.signedUrl,
    filename: file.name,
    mime: file.type,
    kind,
    bytes: file.size,
  });
}
