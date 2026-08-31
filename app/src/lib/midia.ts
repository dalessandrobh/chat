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
import { getMediaBase64 } from "@/lib/evolution/client";
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
 * Devolve o texto da mídia, ou null quando não deu — sem chave, formato que
 * não lemos, download falho ou erro do provedor. Null significa "trate como
 * antes": a conversa vai para uma pessoa.
 */
export async function entenderMidia(event: EvoInboundMessage): Promise<string | null> {
  const ehImagem = event.type === "image" || event.type === "sticker";
  const ehAudio = event.type === "audio";
  if (!ehImagem && !ehAudio) return null;
  if (ehImagem && !serverEnv.midia.leImagem) return null;
  if (ehAudio && !serverEnv.midia.leAudio) return null;

  const base64 = await baixar(event);
  if (!base64) return null;

  try {
    return ehImagem
      ? await descreverImagem(base64, event.media?.mimeType ?? "image/jpeg")
      : await transcreverAudio(base64, event.media?.mimeType ?? "audio/ogg");
  } catch (err) {
    console.error(`[mídia] não consegui ler ${event.type}`, err);
    return null;
  }
}

/**
 * O webhook às vezes já traz o base64 e às vezes não, dependendo de como a
 * instância está configurada. Quando não traz, a Evolution devolve o arquivo
 * decriptado sob demanda.
 */
async function baixar(event: EvoInboundMessage): Promise<string | null> {
  if (event.media?.base64) return event.media.base64;

  try {
    const baixada = await getMediaBase64(event.instanceName, event.waMessageId);
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

  const resposta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.midia.openaiKey}` },
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
