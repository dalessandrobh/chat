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
        .select("*")
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
            setMessages((prev) =>
              prev.some((m) => m.id === message.id) ? prev : [...prev, message]
            );
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
            prev.map((m) => (m.id === updated.id ? updated : m))
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
  }, [supabase, selectedId, loadRows]);

  // --- Derivados --------------------------------------------------------

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.contact_name.toLowerCase().includes(term) || r.wa_id.includes(term)
    );
  }, [rows, filter]);

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
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <HandoffBar row={selected} onChanged={refresh} />
            <MessageThread messages={messages} />
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
