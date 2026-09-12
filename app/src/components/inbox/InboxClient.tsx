"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { autenticarRealtime } from "@/lib/supabase/realtime";
import { ehMinha, porEsperaMaisLonga } from "@/lib/fila";
import type { AgenteResumo, InboxRow, Message, Template } from "@/lib/types";
import { ConversationList, type Aba } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import { HandoffBar } from "./HandoffBar";
import { MemoriaDoContato } from "./MemoriaDoContato";
import { Composer } from "./Composer";

export function InboxClient({
  agenteId,
  initialRows,
  templates,
  agentes,
  nomeDoBot,
}: {
  agenteId: string | null;
  initialRows: InboxRow[];
  templates: Template[];
  agentes: AgenteResumo[];
  /** Como a automação se chama nesta empresa. "bot" quando ninguém nomeou. */
  nomeDoBot: string;
}) {
  const [rows, setRows] = useState<InboxRow[]>(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * No celular as duas colunas não cabem lado a lado: ou a fila, ou a
   * conversa. Este é o que está na frente. No tablet e no PC não vale nada —
   * as duas colunas aparecem juntas de qualquer forma.
   */
  const [threadNaFrente, setThreadNaFrente] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState("");
  /** Encerradas ficam de fora por padrão: a lista é a fila de trabalho, não o arquivo. */
  const [mostrarEncerradas, setMostrarEncerradas] = useState(false);
  /**
   * Abre em "Aguardando" quando há alguém esperando.
   *
   * Não é preferência: é a ordem do trabalho. Quem abre o painel com três
   * clientes na fila não quer decidir por onde começar.
   */
  const [aba, setAba] = useState<Aba>(() =>
    initialRows.some((r) => r.aguardando_desde) ? "aguardando" : "todas"
  );

  const supabase = supabaseBrowser();

  /**
   * Abrir já na primeira conversa, mas só onde as duas colunas cabem juntas.
   *
   * No celular isso esconderia a fila atrás de uma conversa que ninguém pediu
   * para ver — e, pior, marcaria essa conversa como lida. Não dá para decidir
   * isso na renderização: o servidor não sabe a largura da tela, e chutar aqui
   * é divergir do HTML que ele mandou.
   */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setSelectedId((atual) => atual ?? initialRows[0]?.conversation_id ?? null);
    }
  }, [initialRows]);

  // --- Carregamento -----------------------------------------------------

  const loadRows = useCallback(async () => {
    const { data, error } = await supabase
      .from("inbox")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    // Engolir o erro aqui deixa a fila congelada na tela sem nenhum sinal —
    // que é exatamente o modo de falhar que não se descobre olhando.
    if (error) console.error("[inbox] lista não recarregou:", error.message);
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

  // A lista não pode depender só do Realtime. A carga do servidor pode chegar
  // do cache de rota do Next, a inscrição pode cair com a máquina dormindo, e
  // nos dois casos a fila fica parada sem que ninguém perceba. Recarrega ao
  // montar, ao a aba voltar ao foco, e de minuto em minuto.
  useEffect(() => {
    void loadRows();
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void loadRows();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    const relogio = setInterval(() => void loadRows(), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
      clearInterval(relogio);
    };
  }, [loadRows]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
    // Abrir a conversa marca como lida — só para quem abriu. Como a marca vive
    // em outra tabela, nenhum evento de `conversations` chega para avisar a
    // lista: recarregar aqui é o que faz o contador sumir da tela.
    void (async () => {
      await supabase.rpc("mark_read", { p_conversation_id: selectedId });
      await loadRows();
    })();
  }, [selectedId, loadMessages, loadRows, supabase]);

  // --- Realtime ---------------------------------------------------------

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    const abrir = async () => {
      await autenticarRealtime(supabase);
      if (cancelado) return;

      channel = supabase
        .channel("chat-inbox")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "chat", table: "messages" },
          (payload) => {
            // Inscrição sem permissão devolve o registro vazio, com o erro
            // dentro do próprio payload. Sem isto o evento passaria batido.
            if (payload.errors?.length) {
              console.error("[inbox] realtime recusado:", payload.errors.join(", "));
              void loadRows();
              return;
            }
            const message = payload.new as Message;
            // Só anexa se for da conversa aberta; a lista é recarregada de
            // qualquer forma para atualizar preview e contador.
            if (message.conversation_id === selectedId) {
              // Chegou com a conversa aberta na frente da pessoa: já foi lida.
              if (message.direction === "in") {
                void supabase
                  .rpc("mark_read", { p_conversation_id: selectedId })
                  .then(() => loadRows());
              }
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
            if (payload.errors?.length) return;
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
    };

    void abrir();

    return () => {
      cancelado = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, selectedId, loadRows, loadMessages]);

  // --- Derivados --------------------------------------------------------

  const contagens = useMemo(
    () => ({
      aguardando: rows.filter((r) => r.aguardando_desde).length,
      minhas: rows.filter((r) => ehMinha(r, agenteId)).length,
      todas: rows.filter((r) => r.status !== "closed").length,
    }),
    [rows, agenteId]
  );

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();

    // A busca alcança o arquivo, e atravessa as abas: quem procura por nome
    // quer achar, não descobrir que estava na aba errada.
    if (term) {
      return rows.filter(
        (r) => r.contact_name.toLowerCase().includes(term) || r.wa_id.includes(term)
      );
    }

    if (aba === "aguardando") {
      // Do mais antigo para o mais novo, que é o contrário da lista geral: aqui
      // o que importa não é o que acabou de acontecer, é quem espera há mais
      // tempo.
      return rows.filter((r) => r.aguardando_desde).sort(porEsperaMaisLonga);
    }

    if (aba === "minhas") {
      return rows.filter((r) => ehMinha(r, agenteId));
    }

    return mostrarEncerradas ? rows : rows.filter((r) => r.status !== "closed");
  }, [rows, filter, mostrarEncerradas, aba, agenteId]);

  const encerradas = useMemo(() => rows.filter((r) => r.status === "closed").length, [rows]);

  const selected = rows.find((r) => r.conversation_id === selectedId) ?? null;

  /**
   * Só vale no celular. O `selected` entra na conta porque a conversa pode sair
   * da lista embaixo de quem a está lendo — bloquear o número faz isso — e aí
   * a tela ficaria numa coluna vazia sem botão de voltar.
   */
  const threadNaTela = threadNaFrente && !!selected;

  const refresh = useCallback(() => {
    void loadRows();
    if (selectedId) void loadMessages(selectedId);
  }, [loadRows, loadMessages, selectedId]);

  // --- Render -----------------------------------------------------------

  return (
    <div className="flex h-full min-h-0">
      <ConversationList
        oculta={threadNaTela}
        rows={filtered}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setThreadNaFrente(true);
        }}
        filter={filter}
        onFilterChange={setFilter}
        encerradas={encerradas}
        mostrarEncerradas={mostrarEncerradas}
        onMostrarEncerradas={setMostrarEncerradas}
        aba={aba}
        onAba={setAba}
        contagens={contagens}
      />

      <section
        className={`min-w-0 flex-1 flex-col md:flex ${threadNaTela ? "flex" : "hidden"}`}
      >
        {selected ? (
          <>
            <HandoffBar
              row={selected}
              agenteId={agenteId}
              agentes={agentes}
              onChanged={refresh}
              // Soltar a conversa junto com o painel: o Realtime marca como
              // lida toda mensagem que chega na conversa aberta, e depois de
              // voltar para a fila ela não está aberta na frente de ninguém.
              onVoltar={() => {
                setThreadNaFrente(false);
                setSelectedId(null);
              }}
            />
            {/* Entre a barra e a conversa, recolhida: quem abre a conversa
                quer ler a conversa. Mas antes de responder a alguém que já
                falou aqui, o que se sabe dela está a um clique. */}
            <MemoriaDoContato
              key={selected.contact_id}
              contactId={selected.contact_id}
              contactName={selected.contact_name}
            />
            <MessageThread
              messages={messages}
              contactName={selected.contact_name}
              nomeDoBot={nomeDoBot}
            />
            <Composer
              row={selected}
              agenteId={agenteId}
              templates={templates}
              onSent={refresh}
            />
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
