/**
 * GET /api/messages/:id/media — o arquivo que o cliente mandou.
 *
 * Os bytes vêm do banco, onde a Evolution já os entregou em base64 junto do
 * evento. Não há ida à Evolution nem à CDN do WhatsApp: mídia de WhatsApp
 * expira na origem, e uma foto de três meses atrás só continua existindo
 * porque foi guardada aqui.
 *
 * A leitura é pela sessão de quem pediu, nunca pela chave de serviço. É a
 * RLS que decide: a linha não aparece para quem não é da empresa dona da
 * conversa, e a rota devolve 404 sem precisar comparar empresa nenhuma na
 * mão — o mesmo 404 de uma mensagem que não existe, que também é a resposta
 * certa para quem não deveria saber que ela existe.
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { currentAgent, unauthorized } from "@/lib/auth";

/**
 * O que o navegador pode abrir na própria página.
 *
 * O tipo do arquivo é escolhido por quem mandou a mensagem — um estranho, do
 * lado de fora. Servir `text/html` de dentro do domínio do painel entregaria
 * a sessão de quem atende a qualquer um com o número. Fora desta lista, o
 * arquivo desce como download opaco, que o navegador não interpreta.
 */
const INLINE = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/webm",
  "application/pdf",
]);

/** Nome de arquivo sem aspas nem quebra de linha: o cabeçalho é montado com
 *  um valor que veio de fora e precisa continuar sendo um cabeçalho só. */
function nomeSeguro(nome: string | null | undefined, tipo: string): string {
  const limpo = (nome ?? "").replace(/[^\p{L}\p{N}._ -]/gu, "").trim();
  if (limpo) return limpo.slice(0, 120);
  const ext = tipo.split("/")[1]?.split(";")[0] ?? "bin";
  return `arquivo.${ext}`;
}

/**
 * Lê o cabeçalho `Range` que o navegador manda para vídeo e áudio.
 *
 * Não é otimização: o Safari pede `bytes=0-1` antes de tocar qualquer coisa e
 * desiste se a resposta vier 200 em vez de 206. Sem isto o vídeo simplesmente
 * não roda no iPhone — e quem atende costuma estar no celular.
 */
function faixa(header: string | null, total: number) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m) return null;

  const [, inicioTxt, fimTxt] = m;
  // "bytes=-500" são os últimos 500; "bytes=500-" é de 500 até o fim.
  const inicio = inicioTxt ? Number(inicioTxt) : Math.max(0, total - Number(fimTxt || 0));
  const fim = inicioTxt ? (fimTxt ? Math.min(Number(fimTxt), total - 1) : total - 1) : total - 1;

  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio > fim || inicio >= total) {
    return null;
  }
  return { inicio, fim };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await currentAgent();
  if (!agent) return unauthorized();

  const { id } = await params;
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("messages")
    .select("media, media_mime, media_filename")
    .eq("id", id)
    .maybeSingle();

  const base64 = (data?.media as { base64?: string } | null)?.base64;
  if (!base64) {
    return NextResponse.json({ error: "Mensagem sem arquivo" }, { status: 404 });
  }

  const declarado = (data?.media_mime ?? "").split(";")[0].trim().toLowerCase();
  const podeAbrir = INLINE.has(declarado);
  const tipo = podeAbrir ? declarado : "application/octet-stream";
  const nome = nomeSeguro(data?.media_filename, declarado || "application/octet-stream");

  const bytes = Buffer.from(base64, "base64");
  const pedaco = faixa(request.headers.get("range"), bytes.length);
  const corpo = pedaco ? bytes.subarray(pedaco.inicio, pedaco.fim + 1) : bytes;

  return new NextResponse(corpo, {
    status: pedaco ? 206 : 200,
    headers: {
      "Content-Type": tipo,
      "Accept-Ranges": "bytes",
      "Content-Length": String(corpo.length),
      ...(pedaco && {
        "Content-Range": `bytes ${pedaco.inicio}-${pedaco.fim}/${bytes.length}`,
      }),
      "Content-Disposition": `${podeAbrir ? "inline" : "attachment"}; filename="${nome}"`,
      // O tipo veio de fora: sem isto o navegador pode farejar o conteúdo e
      // tratar como HTML o que declaramos como imagem.
      "X-Content-Type-Options": "nosniff",
      // Nem que farejasse: o sandbox impede script e navegação nesta resposta.
      "Content-Security-Policy": "sandbox; default-src 'none'; media-src 'self'; img-src 'self'",
      // Privado e imutável: a mensagem nunca muda de arquivo, mas o cache é
      // do navegador de quem tem sessão, não de nenhum intermediário.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
