"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { autenticarRealtime } from "@/lib/supabase/realtime";

const Ctx = createContext<Set<string>>(new Set());

/** Ids dos atendentes com o painel aberto agora. */
export function usePresenca(): Set<string> {
  return useContext(Ctx);
}

/**
 * Quem está com o painel aberto, pelo Presence do Realtime.
 *
 * Serve para não direcionar conversa a quem foi almoçar. É um sinal fraco de
 * propósito — a aba pode estar aberta e a pessoa não estar na frente dela —,
 * então em lugar nenhum ele decide: só informa.
 *
 * O canal é privado, e privado no Realtime quer dizer autorizado pela RLS de
 * `realtime.messages`. A política deixa cada agente entrar apenas no tópico
 * `presenca:<empresa dele>`, então saber quem está online não é assunto
 * compartilhado entre as empresas do painel.
 *
 * Fica no layout porque a presença é de quem está com o painel aberto, e não
 * de quem está na tela de conversas: quem foi ver um template continua ali.
 */
export function PresencaProvider({
  agenteId,
  nome,
  empresaId,
  children,
}: {
  agenteId: string;
  nome: string | null;
  empresaId: string;
  children: React.ReactNode;
}) {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const supabase = supabaseBrowser();

  useEffect(() => {
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    const abrir = async () => {
      await autenticarRealtime(supabase);
      if (cancelado) return;

      canal = supabase.channel(`presenca:${empresaId}`, {
        config: { private: true, presence: { key: agenteId } },
      });

      canal
        .on("presence", { event: "sync" }, () => {
          setOnline(new Set(Object.keys(canal?.presenceState() ?? {})));
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await canal?.track({ nome, desde: new Date().toISOString() });
          }
        });
    };
    void abrir();

    return () => {
      cancelado = true;
      if (canal) void supabase.removeChannel(canal);
    };
  }, [supabase, agenteId, nome, empresaId]);

  return <Ctx.Provider value={online}>{children}</Ctx.Provider>;
}
