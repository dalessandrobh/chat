"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { InboxRow, Message, Template } from "@/lib/types";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import { HandoffBar } from "./HandoffBar";
import { Composer } from "./Composer";

export function InboxClient({
  initialRows,
  templates,
}: {
  initialRows: InboxRow[];
  templates: Template[];
}) {
  const [rows, setRows] = useState<InboxRow[]>(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRows[0]?.conversation_id ?? null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState("");
  /** Encerradas ficam de fora por padrão: a lista é a fila de trabalho, não o arquivo. */
  const [mostrarEncerradas, setMostrarEncerradas] = useState(false);

  const supabase = supabaseBrowser();

  // --- Carregamento -----------------------------------------------------

  const loadRows = useCallback(async () => {
    const { data } = await supabase
      .from("inbox")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (data) setRows(data as InboxRow[]);
  }, [supabase]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const { data } = await supabase
        .from("messages")
        // Colunas na mão, e não `*`, por causa de duas: `media` guarda o
        // arquivo inteiro em base64 e `payload` guarda o evento cru. Com `*`
        // uma conversa com um vídeo baixava megabytes para o navegador só
        // para desenhar a bolha. O que descreve a mídia vem nas colunas
        // geradas; os bytes, só quando a bolha os pedir.
        //
        // O nome do agente vem junto: sem ele toda resposta da equipe aparece
        // como "você", inclusive a que outra pessoa mandou ontem.
        .select(
          "id, conversation_id, direction, wa_message_id, type, body, has_media, media_mime, media_filename, media_seconds, status, error, author, agent_id, template_id, created_at, agent:agents(full_name)"
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(300);
      if (data) setMessages(data as Message[]);
    },
    [supabase]
  );

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
    // Zera o contador de não lidas ao abrir a conversa.
    void supabase.rpc("mark_read", { p_conversation_id: selectedId });
  }, [selectedId, loadMessages, supabase]);

  // --- Realtime ---------------------------------------------------------

  useEffect(() => {
    const channel = supabase
      .channel("chat-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "chat", table: "messages" },
        (payload) => {
          const message = payload.new as Message;
          // Só anexa se for da conversa aberta; a lista é recarregada de
          // qualquer forma para atualizar preview e contador.
          if (message.conversation_id === selectedId) {
            if (message.agent_id) {
              // O payload do realtime não traz o join com agents. Anexar cru
              // faria a resposta de um atendente aparecer sem nome até o
              // próximo recarregamento — piscando na tela de quem assiste.
              void loadMessages(selectedId);
            } else {
              setMessages((prev) =>
                prev.some((m) => m.id === message.id) ? prev : [...prev, message]
              );
            }
          }
          void loadRows();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "chat", table: "messages" },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            // Mesma história: o payload não traz o join, e uma simples
            // confirmação de entrega apagaria o nome de quem respondeu.
            prev.map((m) => (m.id === updated.id ? { ...updated, agent: m.agent } : m))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "chat", table: "conversations" },
        () => void loadRows()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, selectedId, loadRows, loadMessages]);

  // --- Derivados --------------------------------------------------------

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    // A busca alcança o arquivo: quem procura por nome quer achar mesmo que a
    // conversa já tenha sido encerrada.
    const base = mostrarEncerradas || term ? rows : rows.filter((r) => r.status !== "closed");
    if (!term) return base;
    return base.filter(
      (r) =>
        r.contact_name.toLowerCase().includes(term) || r.wa_id.includes(term)
    );
  }, [rows, filter, mostrarEncerradas]);

  const encerradas = useMemo(() => rows.filter((r) => r.status === "closed").length, [rows]);

  const selected = rows.find((r) => r.conversation_id === selectedId) ?? null;

  const refresh = useCallback(() => {
    void loadRows();
    if (selectedId) void loadMessages(selectedId);
  }, [loadRows, loadMessages, selectedId]);

  // --- Render -----------------------------------------------------------

  return (
    <div className="flex h-full min-h-0">
      <ConversationList
        rows={filtered}
        selectedId={selectedId}
        onSelect={setSelectedId}
        filter={filter}
        onFilterChange={setFilter}
        encerradas={encerradas}
        mostrarEncerradas={mostrarEncerradas}
        onMostrarEncerradas={setMostrarEncerradas}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <HandoffBar row={selected} onChanged={refresh} />
            <MessageThread messages={messages} contactName={selected.contact_name} />
            <Composer row={selected} templates={templates} onSent={refresh} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Selecione uma conversa à esquerda.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
