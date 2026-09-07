"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { autenticarRealtime } from "@/lib/supabase/realtime";

const PREFERENCIA = "chat:avisar-fila";

/**
 * O link para as conversas, com o tamanho da fila em cima.
 *
 * Fica no cabeçalho porque a fila não é assunto só de quem está na tela do
 * inbox: quem foi ver um template precisa saber que chegou gente esperando. Do
 * mesmo lugar saem os dois avisos — o som e a notificação do navegador — para
 * a detecção de "conversa nova na fila" existir uma vez só.
 */
export function ConversasLink() {
  const [aguardando, setAguardando] = useState<string[]>([]);
  const [avisar, setAvisar] = useState(false);

  /** Ids já vistos. Sem isto, a primeira carga tocaria por conversa antiga. */
  const conhecidos = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);

  const supabase = supabaseBrowser();
  const rota = usePathname();

  useEffect(() => {
    try {
      setAvisar(localStorage.getItem(PREFERENCIA) === "1");
    } catch {
      // Navegador com armazenamento bloqueado: fica sem aviso, não sem painel.
    }
  }, []);

  const tocar = useCallback(() => {
    const ctx = audio.current;
    if (!ctx) return;
    // Dois bipes curtos, feitos na hora: um arquivo de som precisaria vir de
    // algum lugar, e o painel não carrega nada de fora.
    const agora = ctx.currentTime;
    for (const [i, hz] of [880, 1174].entries()) {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = hz;
      vol.gain.setValueAtTime(0.0001, agora + i * 0.18);
      vol.gain.exponentialRampToValueAtTime(0.12, agora + i * 0.18 + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, agora + i * 0.18 + 0.16);
      osc.connect(vol).connect(ctx.destination);
      osc.start(agora + i * 0.18);
      osc.stop(agora + i * 0.18 + 0.18);
    }
  }, []);

  const avisarChegada = useCallback(
    (quantas: number) => {
      let ligado = false;
      try {
        ligado = localStorage.getItem(PREFERENCIA) === "1";
      } catch {
        ligado = false;
      }
      if (!ligado) return;

      tocar();

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        // Uma notificação só, com a mesma tag: cinco conversas em sequência não
        // devem virar cinco caixinhas empilhadas na tela de quem já entendeu.
        new Notification(
          quantas > 1 ? `${quantas} conversas esperando atendimento` : "Conversa esperando atendimento",
          { body: "Ninguém assumiu ainda.", tag: "chat-fila" }
        );
      }
    },
    [tocar]
  );

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("inbox")
      .select("conversation_id")
      .not("aguardando_desde", "is", null)
      .limit(500);

    if (error) {
      console.error("[fila] contagem não recarregou:", error.message);
      return;
    }

    const ids = (data ?? []).map((r) => r.conversation_id as string);
    setAguardando(ids);

    const antes = conhecidos.current;
    conhecidos.current = new Set(ids);
    // Na primeira carga não há "chegou": há o que já estava lá.
    if (!antes) return;

    const novas = ids.filter((id) => !antes.has(id));
    if (novas.length > 0) avisarChegada(novas.length);
  }, [supabase, avisarChegada]);

  useEffect(() => {
    void carregar();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    const abrir = async () => {
      await autenticarRealtime(supabase);
      if (cancelado) return;
      channel = supabase
        .channel("chat-fila")
        .on(
          "postgres_changes",
          { event: "*", schema: "chat", table: "conversations" },
          () => void carregar()
        )
        .subscribe();
    };
    void abrir();

    // O Realtime é o caminho normal; o relógio é o que segura a queda dele.
    const relogio = setInterval(() => void carregar(), 60_000);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      cancelado = true;
      if (channel) void supabase.removeChannel(channel);
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [supabase, carregar]);

  // O título da aba é o aviso que sobrevive ao painel estar em segundo plano.
  // Depende da rota porque cada página escreve o próprio título ao entrar, e
  // sem reaplicar o contador some ao navegar.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = aguardando.length > 0 ? `(${aguardando.length}) ${base}` : base;
  }, [aguardando.length, rota]);

  async function alternarAviso() {
    if (avisar) {
      setAvisar(false);
      try {
        localStorage.setItem(PREFERENCIA, "0");
      } catch {}
      return;
    }

    // O clique é o que autoriza o som: sem gesto do usuário o navegador nem
    // deixa o AudioContext sair do estado suspenso.
    if (!audio.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audio.current = new Ctor();
    }
    await audio.current?.resume().catch(() => {});

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => "denied");
    }

    setAvisar(true);
    try {
      localStorage.setItem(PREFERENCIA, "1");
    } catch {}
    tocar();
  }

  return (
    <span className="flex items-center gap-1.5">
      <Link href="/inbox" className="hover:underline">
        Conversas
      </Link>
      {aguardando.length > 0 && (
        <Link
          href="/inbox"
          title={`${aguardando.length} esperando atendimento`}
          className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
        >
          {aguardando.length}
        </Link>
      )}
      <button
        onClick={alternarAviso}
        title={
          avisar
            ? "Avisos ligados — clique para desligar"
            : "Avisar com som e notificação quando entrar conversa na fila"
        }
        aria-label={avisar ? "Desligar avisos da fila" : "Ligar avisos da fila"}
        className="text-xs opacity-60 transition hover:opacity-100"
      >
        {avisar ? "🔔" : "🔕"}
      </button>
    </span>
  );
}
