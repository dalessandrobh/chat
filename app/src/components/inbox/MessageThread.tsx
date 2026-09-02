"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/types";

const STATUS_ICON: Record<string, string> = {
  queued: "🕓",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "⚠",
};

/**
 * Quem falou.
 *
 * Antes o lado de fora não tinha nome nenhum e o de dentro dizia sempre
 * "você" — inclusive na resposta que outra pessoa da equipe mandou ontem.
 * Numa conversa que passa de mão em mão, saber quem disse o quê é metade da
 * leitura.
 */
function quemFalou(message: Message, contactName: string): string {
  if (message.direction === "in") return contactName;

  switch (message.author) {
    case "bot":
      return "bot";
    case "system":
      return "sistema";
    default:
      // Atendente sem agent_id é o dono respondendo pelo próprio aparelho: a
      // mensagem chega pelo webhook da Evolution, não pelo painel.
      return message.agent?.full_name ?? "pelo celular";
  }
}

function AuthorTag({ message, contactName }: { message: Message; contactName: string }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide opacity-60">
      {quemFalou(message, contactName)}
      {message.type === "template" && " · template"}
    </span>
  );
}

const ICONE_MIDIA: Record<string, string> = {
  image: "📷",
  sticker: "📷",
  audio: "🎤",
  video: "🎬",
  document: "📄",
};

/**
 * O rótulo diz de onde veio o texto. Sem isso o atendente lê a descrição da
 * foto como se o cliente tivesse escrito aquilo — e responde a uma frase que
 * ninguém disse.
 */
function rotuloMidia(message: Message) {
  const icone = ICONE_MIDIA[message.type] ?? "📎";
  const tipo = message.media_mime ?? message.type;

  if (!message.body) return `${icone} ${tipo}`;
  return message.type === "audio"
    ? `${icone} áudio — transcrito automaticamente`
    : `${icone} ${tipo} — descrição automática`;
}

function duracao(segundos: number | null) {
  if (!segundos) return null;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * O arquivo em si.
 *
 * Sempre esteve no banco — a Evolution manda o base64 junto do evento — e o
 * painel nunca mostrou. Quem atendia lia "📷 image/jpeg" e a descrição que o
 * modelo escreveu, e respondia sobre uma foto que não podia abrir. Numa
 * conversa de aquecedor a foto costuma ser o telhado, a caixa d'água ou a
 * placa do concorrente: é o conteúdo da mensagem, não um anexo dela.
 *
 * A bolha pede os bytes ao abrir, um por vez, em vez de a lista inteira vir
 * carregada. `preload="metadata"` no vídeo é a mesma ideia: baixa o
 * suficiente para ter primeiro quadro e duração, e o resto só se alguém der
 * play.
 */
function Anexo({ message }: { message: Message }) {
  const src = `/api/messages/${message.id}/media`;
  const tipo = message.media_mime ?? "";
  const tempo = duracao(message.media_seconds);

  if (tipo.startsWith("image/")) {
    return (
      /* Abre em aba nova no tamanho original: no celular do cliente a foto
         tem detalhe que não cabe na largura da bolha. */
      <a href={src} target="_blank" rel="noopener noreferrer" className="mt-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={message.body ?? "Imagem recebida"}
          loading="lazy"
          className="max-h-72 w-auto rounded-lg"
        />
      </a>
    );
  }

  if (tipo.startsWith("video/")) {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="mt-1 max-h-72 w-full rounded-lg"
      />
    );
  }

  if (tipo.startsWith("audio/")) {
    return <audio src={src} controls preload="metadata" className="mt-1 w-full" />;
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-lg border border-black/10 px-2 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
    >
      <span>{ICONE_MIDIA[message.type] ?? "\u{1F4CE}"}</span>
      <span className="truncate">{message.media_filename ?? "abrir arquivo"}</span>
      {tempo && <span className="opacity-60">{tempo}</span>}
    </a>
  );
}

function Bubble({ message, contactName }: { message: Message; contactName: string }) {
  const incoming = message.direction === "in";
  const failed = message.status === "failed";

  return (
    <div className={`flex ${incoming ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[70%] rounded-xl px-3 py-2 shadow-sm ${
          incoming
            ? "rounded-tl-sm bg-white dark:bg-[#202c33]"
            : failed
              ? "rounded-tr-sm bg-red-50 dark:bg-red-950/50"
              : "rounded-tr-sm bg-wa-bubble dark:bg-[#005c4b]"
        }`}
      >
        <AuthorTag message={message} contactName={contactName} />

        {message.media_mime || message.has_media ? (
          <>
            {message.has_media && <Anexo message={message} />}
            <p className="text-[11px] italic opacity-60">{rotuloMidia(message)}</p>
            {message.body && (
              <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
            )}
          </>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.body ?? `[${message.type}]`}
          </p>
        )}

        {failed && (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
            Falha no envio: {String(message.error?.message ?? "erro desconhecido")}
          </p>
        )}

        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-60">
          <span>
            {new Date(message.created_at).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {!incoming && (
            <span className={message.status === "read" ? "text-sky-500" : ""}>
              {STATUS_ICON[message.status]}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function MessageThread({
  messages,
  contactName,
}: {
  messages: Message[];
  contactName: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Rola para o fim quando chega mensagem nova.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="thread-bg flex-1 space-y-2 overflow-y-auto p-4">
      {messages.map((message) => (
        <Bubble key={message.id} message={message} contactName={contactName} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
