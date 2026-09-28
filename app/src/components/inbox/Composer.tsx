"use client";

import { useEffect, useRef, useState } from "react";
import type { InboxRow, Template } from "@/lib/types";
import { templateBody } from "@/lib/types";
import { ACCEPT, LIMITE_BYTES, tipoDeMidia } from "@/lib/midia-enviada";
import type { MediaKind } from "@/lib/meta/client";
import { TemplatePicker } from "./TemplatePicker";

/** O arquivo escolhido, esperando a legenda e o clique em enviar. */
interface Anexo {
  file: File;
  /** `sticker` não entra: a lista de tipos aceitos não tem como produzi-lo. */
  kind: Exclude<MediaKind, "sticker">;
  /** Prévia local. Só existe enquanto a caixa está aberta. */
  url: string;
  /** Gravado aqui: sai como mensagem de voz, não como arquivo anexado. */
  voz: boolean;
  segundos?: number;
}

/** Sobe o arquivo e devolve o que o envio precisa saber sobre ele. */
function subir(
  file: File,
  conversationId: string,
  onProgresso: (pct: number) => void
): Promise<{ url: string; storagePath: string; mime: string; filename: string; kind: string }> {
  // XHR, e não fetch: é o que reporta quanto do arquivo já subiu, e um vídeo
  // de 15 MB na internet do escritório leva tempo suficiente para a barra
  // importar.
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("conversationId", conversationId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/messages/media");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const json = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else reject(new Error(json.error ?? "Falha ao subir o arquivo"));
    };
    xhr.onerror = () => reject(new Error("Falha de rede ao subir o arquivo"));
    xhr.send(form);
  });
}

/** mm:ss, para a duração da gravação. */
function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Caixa de envio.
 *
 * Bloqueios deliberados, para o agente não descobrir o problema só depois de
 * a Meta recusar — ou, pior, só depois de o cliente receber duas respostas:
 *   - conversa que não é sua: texto desabilitado, com o nome de quem atende;
 *   - conversa em modo bot ou ainda sem dono: texto desabilitado, com atalho
 *     para assumir;
 *   - fora da janela de 24h: texto desabilitado, só template libera.
 *
 * O servidor recusa as mesmas coisas. Aqui é só para a recusa chegar antes do
 * clique, e não depois.
 */
export function Composer({
  row,
  agenteId,
  templates,
  onSent,
}: {
  row: InboxRow;
  agenteId: string | null;
  templates: Template[];
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);

  // A prévia é um endereço na memória do navegador: sem soltar, cada anexo
  // escolhido deixa o arquivo inteiro preso até a aba fechar.
  useEffect(() => {
    return () => {
      if (anexo) URL.revokeObjectURL(anexo.url);
    };
  }, [anexo]);

  // O contador da gravação. Roda só enquanto grava, e o `segundos` que ele
  // deixa é a duração que vai junto do áudio.
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  const souDono = !!agenteId && row.assigned_agent_id === agenteId;
  const isBot = row.mode === "bot";
  const semDono = !isBot && !row.assigned_agent_id;
  const deOutro = !isBot && !!row.assigned_agent_id && !souDono;
  const donoNome = row.assigned_agent_name?.split(" ")[0] ?? "Outro atendente";
  const blocked = !souDono || !row.within_window;

  async function post(body: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha ao enviar");
      setText("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function sendText() {
    if (!text.trim()) return;
    void post({ type: "text", conversationId: row.conversation_id, text: text.trim() });
  }

  function escolher(file: File | null | undefined) {
    if (!file) return;
    setError(null);

    const kind = tipoDeMidia(file.type);
    if (!kind) {
      setError(`O WhatsApp não aceita arquivos ${file.type || "deste tipo"}.`);
      return;
    }
    if (file.size > LIMITE_BYTES) {
      setError(
        `Arquivo de ${(file.size / 1e6).toFixed(1)} MB. O WhatsApp recusa acima de ${
          LIMITE_BYTES / 1e6
        } MB.`
      );
      return;
    }

    setAnexo({
      file,
      kind: kind as Exclude<MediaKind, "sticker">,
      url: URL.createObjectURL(file),
      voz: false,
    });
  }

  async function gravar() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const gravador = new MediaRecorder(stream);
      const pedacos: BlobPart[] = [];

      gravador.ondataavailable = (e) => pedacos.push(e.data);
      gravador.onstop = () => {
        // A trilha continua aberta depois do stop: sem fechar, o ponto vermelho
        // do microfone fica aceso no navegador como se ainda estivesse gravando.
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(pedacos, { type: gravador.mimeType });
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
        setAnexo({
          file,
          kind: "audio",
          url: URL.createObjectURL(file),
          voz: true,
          segundos: segundos || 1,
        });
      };

      gravadorRef.current = gravador;
      setSegundos(0);
      setGravando(true);
      gravador.start();
    } catch {
      setError("Não consegui usar o microfone. Libere o acesso no navegador e tente de novo.");
    }
  }

  function pararGravacao(descartar = false) {
    const gravador = gravadorRef.current;
    if (!gravador) return;
    if (descartar) gravador.onstop = () => gravador.stream.getTracks().forEach((t) => t.stop());
    gravador.stop();
    gravadorRef.current = null;
    setGravando(false);
  }

  function limparAnexo() {
    if (anexo) URL.revokeObjectURL(anexo.url);
    setAnexo(null);
    setProgresso(null);
    if (arquivoRef.current) arquivoRef.current.value = "";
  }

  async function enviarAnexo() {
    if (!anexo) return;
    setSending(true);
    setError(null);
    setProgresso(0);

    try {
      const subido = await subir(anexo.file, row.conversation_id, setProgresso);
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "media",
          conversationId: row.conversation_id,
          kind: anexo.kind,
          link: subido.url,
          storagePath: subido.storagePath,
          mime: subido.mime,
          filename: subido.filename,
          // Voz não leva legenda: o balãozinho não tem onde mostrá-la.
          caption: anexo.voz ? undefined : text.trim() || undefined,
          voice: anexo.voz || undefined,
          seconds: anexo.segundos,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Falha ao enviar");

      setText("");
      limparAnexo();
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgresso(null);
    } finally {
      setSending(false);
    }
  }

  function sendTemplate(template: Template, variables: string[]) {
    setPickerOpen(false);
    void post({
      type: "template",
      conversationId: row.conversation_id,
      templateId: template.id,
      variables,
    });
  }

  const approved = templates.filter((t) => t.status === "APPROVED");

  return (
    <div
      // A faixa do gesto de voltar do iPhone fica por cima do rodapé da
      // página: sem a folga do `safe-area` o botão de enviar cai debaixo dela.
      className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {isBot && (
        <p className="mb-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
          A automação está respondendo esta conversa. Clique em{" "}
          <strong>Assumir conversa</strong> para responder você mesmo.
        </p>
      )}

      {semDono && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          O cliente está esperando um atendente e ninguém assumiu ainda. Clique
          em <strong>Assumir conversa</strong> para responder.
        </p>
      )}

      {deOutro && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          <strong>{donoNome}</strong> está atendendo esta conversa. Para
          responder você mesmo, use <strong>Assumir mesmo assim</strong> — o
          cliente é avisado da troca.
        </p>
      )}

      {souDono && !row.within_window && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          Passaram-se mais de 24h desde a última mensagem do contato. Só um
          template aprovado reabre a conversa.
        </p>
      )}

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {error}
        </p>
      )}

      {gravando && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
             style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" />
          <span className="tabular-nums">{relogio(segundos)}</span>
          <span className="truncate text-xs" style={{ color: "var(--muted)" }}>
            Gravando…
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => pararGravacao(true)} className="text-xs underline"
                    style={{ color: "var(--muted)" }}>
              Descartar
            </button>
            <button onClick={() => pararGravacao()}
                    className="rounded-lg bg-wa-green px-3 py-1 text-xs font-medium text-white">
              Parar
            </button>
          </div>
        </div>
      )}

      {anexo && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border p-2"
             style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          {anexo.kind === "image" && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={anexo.url} alt="" className="h-14 w-14 rounded object-cover" />
          )}
          {anexo.kind === "video" && (
            <video src={anexo.url} className="h-14 w-20 rounded object-cover" muted />
          )}
          {anexo.kind === "audio" && <audio src={anexo.url} controls className="h-10 max-w-[60%]" />}
          {anexo.kind === "document" && <span className="text-2xl">📄</span>}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {anexo.voz ? `Mensagem de voz · ${relogio(anexo.segundos ?? 0)}` : anexo.file.name}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {(anexo.file.size / 1e6).toFixed(1)} MB
              {progresso !== null && ` · subindo ${progresso}%`}
            </p>
            {progresso !== null && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded bg-black/10 dark:bg-white/15">
                <div className="h-full bg-wa-green transition-all" style={{ width: `${progresso}%` }} />
              </div>
            )}
          </div>

          <button onClick={limparAnexo} disabled={sending}
                  title="Remover anexo"
                  className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
                  style={{ borderColor: "var(--border)" }}>
            Remover
          </button>
        </div>
      )}

      <input
        ref={arquivoRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => escolher(e.target.files?.[0])}
      />

      <div className="flex items-end gap-2">
        <button
          onClick={() => arquivoRef.current?.click()}
          disabled={blocked || sending || gravando || !!anexo}
          title="Anexar imagem, vídeo, áudio ou documento"
          className="rounded-lg border px-3 py-2 text-sm transition hover:bg-black/[0.03] disabled:opacity-40 dark:hover:bg-white/[0.05]"
          style={{ borderColor: "var(--border)" }}
        >
          📎
        </button>

        <button
          onClick={() => (gravando ? pararGravacao() : void gravar())}
          disabled={blocked || sending || !!anexo}
          title={gravando ? "Parar a gravação" : "Gravar mensagem de voz"}
          className={`rounded-lg border px-3 py-2 text-sm transition hover:bg-black/[0.03] disabled:opacity-40 dark:hover:bg-white/[0.05] ${
            gravando ? "border-red-500 text-red-600 dark:text-red-400" : ""
          }`}
          style={gravando ? undefined : { borderColor: "var(--border)" }}
        >
          🎤
        </button>

        <button
          onClick={() => setPickerOpen(true)}
          disabled={!souDono || approved.length === 0}
          title={
            approved.length === 0
              ? "Nenhum template aprovado. Cadastre em Templates."
              : "Enviar template aprovado"
          }
          className="rounded-lg border px-3 py-2 text-sm transition hover:bg-black/[0.03] disabled:opacity-40 dark:hover:bg-white/[0.05]"
          style={{ borderColor: "var(--border)" }}
        >
          📋
        </button>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (anexo) void enviarAnexo();
              else sendText();
            }
          }}
          disabled={blocked || sending || (anexo?.voz ?? false)}
          rows={1}
          placeholder={
            anexo
              ? anexo.voz
                ? "Mensagem de voz vai sem legenda"
                : "Legenda (opcional)"
              : deOutro
              ? `${donoNome} está atendendo esta conversa…`
              : !souDono
                ? "Assuma a conversa para responder…"
                : !row.within_window
                  ? "Janela fechada — envie um template"
                  : "Escreva uma mensagem…"
          }
          // 16px no celular: com fonte menor o iOS dá zoom ao focar e a
          // conversa some da tela na hora de escrever.
          className="max-h-32 flex-1 resize-none rounded-lg border px-3 py-2 text-base outline-none disabled:opacity-60 md:text-sm"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />

        <button
          onClick={() => (anexo ? void enviarAnexo() : sendText())}
          disabled={blocked || sending || gravando || (!anexo && !text.trim())}
          className="rounded-lg bg-wa-green px-3 py-2 text-sm font-medium text-white transition hover:bg-wa-teal disabled:opacity-40 md:px-4"
        >
          {/* No celular o rótulo vira ícone: os 70px de "Enviar" saem da
              largura de quem está escrevendo. */}
          {sending ? (
            "…"
          ) : (
            <>
              <span className="md:hidden">➤</span>
              <span className="hidden md:inline">Enviar</span>
            </>
          )}
        </button>
      </div>

      {pickerOpen && (
        <TemplatePicker
          templates={approved}
          onCancel={() => setPickerOpen(false)}
          onConfirm={sendTemplate}
        />
      )}
    </div>
  );
}

export { templateBody };
