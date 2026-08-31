"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Channel {
  id: string;
  name: string;
  provider: "meta_cloud" | "evolution";
  instance_name: string | null;
  display_phone_number: string | null;
  connection_state: string;
  connected_at: string | null;
  is_active: boolean;
}

const STATE_LABEL: Record<string, { text: string; className: string }> = {
  open: {
    text: "Conectado",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  connecting: {
    text: "Aguardando leitura do QR",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  close: {
    text: "Desconectado",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  unknown: {
    text: "Estado desconhecido",
    className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  },
};

export function CanaisClient({
  initial,
  canManage,
}: {
  initial: Channel[];
  canManage: boolean;
}) {
  const [channels, setChannels] = useState(initial);
  const [criando, setCriando] = useState(false);

  function substituir(channel: Channel) {
    setChannels((prev) => prev.map((c) => (c.id === channel.id ? channel : c)));
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">Canais</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Os números de WhatsApp que este painel atende.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setCriando((v) => !v)}
            className="ml-auto rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
          >
            {criando ? "Fechar" : "Novo número"}
          </button>
        )}
      </div>

      {criando && (
        <NovoCanal
          onCriado={(channel) => {
            setChannels((prev) => [...prev, channel]);
            setCriando(false);
          }}
        />
      )}

      <div className="mt-6 space-y-4">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            canManage={canManage}
            onChanged={substituir}
          />
        ))}

        {channels.length === 0 && (
          <p
            className="rounded-lg border p-6 text-center text-sm"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Nenhum canal cadastrado.
          </p>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

/**
 * Cadastrar cria a instância na Evolution já apontando o webhook para cá. O
 * pareamento fica para depois, no cartão: quem cadastra nem sempre é quem
 * está com o celular na mão.
 */
function NovoCanal({ onCriado }: { onCriado: (channel: Channel) => void }) {
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function criar() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      onCriado(json.channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-4 rounded-lg border p-4"
      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
    >
      <label className="text-sm font-medium">Nome do canal</label>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Como a equipe vai reconhecê-lo na lista — “Vendas”, “Pós-venda”. O
        número aparece sozinho depois do pareamento.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Vendas"
          className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
        <button
          onClick={() => void criar()}
          disabled={busy || nome.trim().length < 2}
          className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Criando…" : "Criar"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------------

function ChannelCard({
  channel,
  canManage,
  onChanged,
}: {
  channel: Channel;
  canManage: boolean;
  onChanged: (channel: Channel) => void;
}) {
  const [state, setState] = useState(channel.connection_state);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const isEvolution = channel.provider === "evolution";
  const label = STATE_LABEL[state] ?? STATE_LABEL.unknown;

  const checkState = useCallback(async () => {
    const response = await fetch(`/api/channels/${channel.id}/state`);
    if (!response.ok) return;
    const json = await response.json();
    setState(json.state);
    // Pareou: some com o QR, que já não serve para nada.
    if (json.state === "open") {
      setQrcode(null);
      setPairingCode(null);
    }
  }, [channel.id]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/channels/${channel.id}/connect`, { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setQrcode(json.qrcode);
      setPairingCode(json.pairingCode);
      // O QR do WhatsApp vale ~40s; avisamos antes de virar um quadrado morto.
      setSecondsLeft(40);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      onChanged(json.channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function trocarNumero() {
    if (
      !confirm(
        `Desconectar o número de "${channel.name}"?\n\n` +
          "As conversas, os contatos e as campanhas continuam neste canal — " +
          "só o aparelho muda. Até parear o novo número, nada entra nem sai."
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/channels/${channel.id}/logout`, { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setState("close");
      setQrcode(null);
      setPairingCode(null);
      onChanged({ ...channel, connection_state: "close", display_phone_number: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Enquanto há QR na tela, perguntamos de 3 em 3s se já leram.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!qrcode) return;

    pollRef.current = setInterval(() => {
      void checkState();
      setSecondsLeft((s) => Math.max(0, s - 3));
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [qrcode, checkState]);

  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--panel)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{channel.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${label.className}`}>
          {label.text}
        </span>
        {!channel.is_active && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Pausado
          </span>
        )}
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {isEvolution ? `Evolution · ${channel.instance_name}` : "Meta Cloud API"}
          {channel.display_phone_number && ` · ${channel.display_phone_number}`}
        </span>

        {canManage && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => void patch({ isActive: !channel.is_active })}
              disabled={busy}
              className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--border)" }}
            >
              {channel.is_active ? "Pausar" : "Retomar"}
            </button>

            {isEvolution && (
              <>
                <button
                  onClick={() => void trocarNumero()}
                  disabled={busy}
                  className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  Trocar número
                </button>
                <button
                  onClick={state === "open" ? checkState : connect}
                  disabled={busy}
                  className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  {busy ? "…" : state === "open" ? "Verificar" : "Conectar com QR"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!channel.is_active && (
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          Pausado: o bot não responde e as campanhas não disparam por este
          número. As mensagens continuam chegando ao painel e podem ser
          respondidas na mão.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {state === "close" && !qrcode && (
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          A sessão caiu e as mensagens não estão sendo entregues. Clique em
          “Conectar com QR” para religar.
        </p>
      )}

      {qrcode && (
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrcode}
            alt="QR Code para parear o WhatsApp"
            width={240}
            height={240}
            className="rounded-lg bg-white p-2"
          />

          <div className="text-sm">
            <p className="font-medium">Como parear</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4" style={{ color: "var(--muted)" }}>
              <li>Abra o WhatsApp no celular</li>
              <li>Toque em Dispositivos conectados</li>
              <li>Conectar um dispositivo</li>
              <li>Aponte para este código</li>
            </ol>

            {pairingCode && (
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                Sem câmera? Use o código{" "}
                <code className="font-mono font-semibold">{pairingCode}</code>
              </p>
            )}

            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              {secondsLeft > 0
                ? `Este código expira em ~${secondsLeft}s.`
                : "Este código expirou — gere outro."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
