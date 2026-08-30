/**
 * POST /api/campaigns/media — sobe o arquivo da campanha
 *
 * O arquivo vai para o Storage do Supabase e a URL pública é o que a Evolution
 * busca na hora do envio. Alternativa seria mandar base64 a cada destinatário,
 * o que subiria o mesmo vídeo trezentas vezes.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentAgent, unauthorized } from "@/lib/auth";
import { canManageTemplates } from "@/lib/roles";

const LIMITE_BYTES = 16 * 1024 * 1024; // o WhatsApp recusa acima disso

const TIPO_POR_MIME: Record<string, "image" | "video" | "audio" | "document"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/mp4": "audio",
};

export async function POST(request: Request) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();
  if (!canManageTemplates(agent.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo recebido." }, { status: 400 });
  }
  if (file.size > LIMITE_BYTES) {
    return NextResponse.json(
      { error: `Arquivo de ${(file.size / 1e6).toFixed(1)} MB. O WhatsApp recusa acima de 16 MB.` },
      { status: 400 }
    );
  }

  const extensao = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const caminho = `${crypto.randomUUID()}.${extensao}`;

  const { error } = await supabaseAdmin()
    .storage.from("campanhas")
    .upload(caminho, file, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data } = supabaseAdmin().storage.from("campanhas").getPublicUrl(caminho);

  return NextResponse.json({
    url: data.publicUrl,
    filename: file.name,
    mime: file.type,
    kind: TIPO_POR_MIME[file.type] ?? "document",
    bytes: file.size,
  });
}
