/**
 * Mídia vira texto antes de chegar ao agente.
 *
 * O agente lê `chat.messages`, e mensagem sem corpo não diz nada a ele: uma
 * foto do telhado ou um áudio de trinta segundos chegavam como "(image)" e a
 * conversa ia direto para uma pessoa. Aqui a foto vira descrição e o áudio
 * vira transcrição, gravadas no corpo da mensagem — o painel passa a mostrar
 * o conteúdo, e o resto do sistema segue tratando tudo como texto.
 *
 * Duas contas diferentes, e é de propósito: a Anthropic descreve imagem mas
 * não recebe áudio. Sem a chave correspondente, cada tipo volta ao
 * comportamento antigo — avisa o cliente e chama alguém. Degradar é melhor
 * que inventar.
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import { lerImagensLigado } from "@/lib/ajustes";
import { getMediaBase64 } from "@/lib/evolution/client";
import { conexaoDoCanal } from "@/lib/canais";
import type { EvoInboundMessage } from "@/lib/evolution/webhook";

/** Formatos que a API de visão aceita. Fora disso, nem tenta. */
const IMAGENS_ACEITAS = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImagemAceita = (typeof IMAGENS_ACEITAS)[number];

const PROMPT_IMAGEM = `Você descreve imagens que clientes mandam no WhatsApp de uma
empresa de aquecedores solares, para que o atendimento saiba o que chegou.

Descreva o que está na imagem em duas ou três frases, em português do Brasil,
começando pelo que importa para um aquecedor solar: telhado e sua inclinação,
caixa d'água, aquecedor já instalado, piscina, planta ou projeto, documento,
print de conversa, foto de produto.

Se for documento, print ou tabela, transcreva os números e nomes que aparecem.
Descreva só o que está na imagem. Não suponha, não recomende, não venda.`;

/**
 * Não devolve só o texto: devolve o que fazer quando não há texto.
 *
 * `perguntar` é para o que sabidamente não vamos ler — vídeo sempre, imagem
 * quando a chave do painel está desligada. Aí o bot explica e pergunta se a
 * pessoa quer alguém, em vez de gastar um atendente com todo arquivo que
 * chega. `escalar` é para a falha: tentamos ler e não deu, e falha não se
 * resolve perguntando.
 */
export type LeituraMidia =
  | { ok: true; texto: string }
  | { ok: false; acao: "perguntar"; leImagens: boolean }
  | { ok: false; acao: "escalar" };

export async function entenderMidia(
  event: EvoInboundMessage,
  channelId: string,
  companyId: string
): Promise<LeituraMidia> {
  const ehImagem = event.type === "image" || event.type === "sticker";
  const ehAudio = event.type === "audio";
  const ehVideo = event.type === "video";

  const leImagens =
    (ehImagem || ehVideo) && serverEnv.midia.leImagem && (await lerImagensLigado(companyId));

  // Vídeo nunca é lido, com a chave ligada ou não — então sempre pergunta.
  if (ehVideo) return { ok: false, acao: "perguntar", leImagens };
  if (ehImagem && !leImagens) return { ok: false, acao: "perguntar", leImagens };

  if (!ehImagem && !ehAudio) return { ok: false, acao: "escalar" };
  if (ehAudio && !serverEnv.midia.leAudio) return { ok: false, acao: "escalar" };

  const base64 = await baixar(event, channelId);
  if (!base64) return { ok: false, acao: "escalar" };

  try {
    const texto = ehImagem
      ? await descreverImagem(base64, event.media?.mimeType ?? "image/jpeg")
      : await transcreverAudio(base64, event.media?.mimeType ?? "audio/ogg");
    return texto ? { ok: true, texto } : { ok: false, acao: "escalar" };
  } catch (err) {
    console.error(`[mídia] não consegui ler ${event.type}`, err);
    return { ok: false, acao: "escalar" };
  }
}

/**
 * O webhook às vezes já traz o base64 e às vezes não, dependendo de como a
 * instância está configurada. Quando não traz, a Evolution devolve o arquivo
 * decriptado sob demanda.
 */
async function baixar(event: EvoInboundMessage, channelId: string): Promise<string | null> {
  if (event.media?.base64) return event.media.base64;

  try {
    const conn = await conexaoDoCanal(channelId);
    const baixada = await getMediaBase64(conn, event.instanceName, event.waMessageId);
    return baixada.base64 ?? null;
  } catch (err) {
    console.error("[mídia] download falhou na Evolution", err);
    return null;
  }
}

async function descreverImagem(base64: string, mimeType: string): Promise<string | null> {
  const tipo = mimeType.split(";")[0].trim().toLowerCase();
  if (!IMAGENS_ACEITAS.includes(tipo as ImagemAceita)) {
    console.error(`[mídia] formato de imagem não suportado: ${tipo}`);
    return null;
  }

  const client = new Anthropic({ apiKey: serverEnv.midia.anthropicKey });

  const resposta = await client.messages.create({
    model: serverEnv.midia.modeloImagem,
    max_tokens: 400,
    // Descrever foto não pede raciocínio longo, e o cliente está esperando.
    output_config: { effort: "low" },
    system: PROMPT_IMAGEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: tipo as ImagemAceita, data: base64 } },
          { type: "text", text: "O que tem nesta imagem?" },
        ],
      },
    ],
  });

  const texto = resposta.content
    .filter((bloco) => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("\n")
    .trim();

  return texto || null;
}

async function transcreverAudio(base64: string, mimeType: string): Promise<string | null> {
  const tipo = mimeType.split(";")[0].trim().toLowerCase();
  // Áudio de WhatsApp é ogg/opus; o Whisper lê direto, sem conversão.
  const extensao = tipo.includes("mp4") || tipo.includes("m4a") ? "m4a" : tipo.includes("mpeg") ? "mp3" : "ogg";

  const form = new FormData();
  form.append("file", new Blob([Buffer.from(base64, "base64")], { type: tipo }), `audio.${extensao}`);
  form.append("model", serverEnv.midia.modeloAudio);
  // Sem isto o Whisper adivinha o idioma, e áudio curto em português com
  // ruído de rua ele às vezes decide que é espanhol.
  form.append("language", "pt");

  const resposta = await fetch(serverEnv.midia.audioUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.midia.audioKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!resposta.ok) {
    console.error(`[mídia] transcrição recusada: HTTP ${resposta.status} — ${(await resposta.text()).slice(0, 200)}`);
    return null;
  }

  const { text } = (await resposta.json()) as { text?: string };
  return text?.trim() || null;
}
