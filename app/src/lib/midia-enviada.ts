/**
 * O que o atendente pode anexar, e até que tamanho.
 *
 * Vive fora das rotas porque a tela precisa da mesma régua: recusar no
 * navegador é dizer "esse arquivo não vai" antes de gastar o upload inteiro,
 * e recusar no servidor é a regra que vale.
 */

import type { MediaKind } from "@/lib/meta/client";

/** Teto do WhatsApp para anexo. Acima disso ele recusa, não importa o resto. */
export const LIMITE_BYTES = 16 * 1024 * 1024;

/**
 * Tipos aceitos, por como o WhatsApp os mostra do outro lado.
 *
 * A lista é curta de propósito: o que não está aqui ou o WhatsApp recusa, ou
 * chega como arquivo que ninguém consegue abrir no celular. Zip fica de fora —
 * é o formato que mais volta como "não consigo ver isso".
 */
const POR_MIME: Record<string, MediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",

  "video/mp4": "video",
  "video/quicktime": "video",

  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/opus": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "audio/wav": "audio",
  "audio/webm": "audio",

  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "text/csv": "document",
  "text/plain": "document",
};

/** O que este arquivo vira no WhatsApp, ou nulo quando ele não entra. */
export function tipoDeMidia(mime: string | null | undefined): MediaKind | null {
  const limpo = (mime ?? "").split(";")[0].trim().toLowerCase();
  return POR_MIME[limpo] ?? null;
}

/** O `accept` do seletor de arquivo: a mesma lista, do jeito que o input lê. */
export const ACCEPT = Object.keys(POR_MIME).join(",");
