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

/** Rótulo de origem da mensagem — deixa claro se foi bot ou pessoa. */
function AuthorTag({ message }: { message: Message }) {
  if (message.direction === "in") return null;

  const label =
    message.author === "bot" ? "bot" : message.author === "system" ? "sistema" : "você";

  return (
    <span className="text-[10px] font-medium uppercase tracking-wide opacity-60">
      {label}
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
  const tipo = String(message.media?.mimeType ?? message.type);

  if (!message.body) return `${icone} ${tipo}`;
  return message.type === "audio"
    ? `${icone} áudio — transcrito automaticamente`
    : `${icone} ${tipo} — descrição automática`;
}

function Bubble({ message }: { message: Message }) {
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
        <AuthorTag message={message} />

        {message.media ? (
          <>
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

export function MessageThread({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Rola para o fim quando chega mensagem nova.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="thread-bg flex-1 space-y-2 overflow-y-auto p-4">
      {messages.map((message) => (
        <Bubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
