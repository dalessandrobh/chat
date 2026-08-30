"use client";

import { useCallback, useEffect, useState } from "react";

interface Campanha {
  campaign_id: string;
  name: string;
  status: string;
  media_kind: string;
  scheduled_at: string | null;
  daily_limit: number;
  interval_min_seconds: number;
  interval_max_seconds: number;
  total: number;
  pendentes: number;
  a_caminho: number;
  entregues: number;
  lidas: number;
  falharam: number;
  ignorados: number;
}

const STATUS: Record<string, { texto: string; cor: string }> = {
  draft:     { texto: "Rascunho",  cor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  scheduled: { texto: "Agendada",  cor: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  running:   { texto: "Enviando",  cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  paused:    { texto: "Pausada",   cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  done:      { texto: "Concluída", cor: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  canceled:  { texto: "Cancelada", cor: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export function CampanhasClient({ channelId }: { channelId: string | null }) {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/campaigns");
    const j = await r.json();
    if (r.ok) setCampanhas(j.campanhas);
  }, []);

  useEffect(() => {
    void refresh();
    // Campanha em andamento muda sozinha: sem isto a tela mente enquanto
    // alguém a observa.
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function mudarStatus(id: string, status: string) {
    const r = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) setAviso({ kind: "erro", text: (await r.json()).error });
    await refresh();
  }

  const total = campanhas.reduce(
    (a, c) => ({
      entregues: a.entregues + Number(c.entregues),
      falharam: a.falharam + Number(c.falharam),
      caminho: a.caminho + Number(c.a_caminho),
      pendentes: a.pendentes + Number(c.pendentes),
    }),
    { entregues: 0, falharam: 0, caminho: 0, pendentes: 0 }
  );

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Campanhas</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Mensagens agendadas para a base.
        </p>
        <button
          onClick={() => setCriando((v) => !v)}
          disabled={!channelId}
          className="ml-auto rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {criando ? "Fechar" : "Nova campanha"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cartao rotulo="Entregues" valor={total.entregues} cor="text-emerald-600 dark:text-emerald-400" />
        <Cartao rotulo="Falharam" valor={total.falharam} cor="text-red-600 dark:text-red-400" />
        <Cartao rotulo="A caminho" valor={total.caminho} />
        <Cartao rotulo="Na fila" valor={total.pendentes} />
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Não existe “inconclusivo”: o WhatsApp confirma cada entrega, então
        “a caminho” é trânsito e sempre vira entregue ou falhou.
      </p>

      {aviso && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {aviso.text}
        </p>
      )}

      {criando && channelId && (
        <Formulario
          channelId={channelId}
          onDone={async (r) => {
            setAviso(r.kind === "erro" ? r : null);
            if (r.kind === "ok") { setCriando(false); await refresh(); }
          }}
        />
      )}

      <div className="mt-6 space-y-3">
        {campanhas.map((c) => {
          const s = STATUS[c.status] ?? STATUS.draft;
          const resolvidas = Number(c.entregues) + Number(c.falharam);
          const pct = c.total ? Math.round((resolvidas / Number(c.total)) * 100) : 0;

          return (
            <div key={c.campaign_id} className="rounded-lg border p-4"
                 style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cor}`}>{s.texto}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {c.media_kind === "text" ? "texto" : c.media_kind} · {c.total} destinatários ·
                  {" "}1 a cada {c.interval_min_seconds}–{c.interval_max_seconds}s · teto {c.daily_limit}/dia
                </span>

                <div className="ml-auto flex gap-2">
                  {c.status === "running" && (
                    <button onClick={() => mudarStatus(c.campaign_id, "paused")}
                            className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                      Pausar
                    </button>
                  )}
                  {(c.status === "paused" || c.status === "draft") && (
                    <button onClick={() => mudarStatus(c.campaign_id, "running")}
                            className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                      {c.status === "draft" ? "Disparar agora" : "Retomar"}
                    </button>
                  )}
                  {["running", "paused", "scheduled", "draft"].includes(c.status) && (
                    <button onClick={() => mudarStatus(c.campaign_id, "canceled")}
                            className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900 dark:text-red-400">
                      Cancelar
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                <div className="h-full bg-wa-green" style={{ width: `${pct}%` }} />
              </div>

              <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: "var(--muted)" }}>
                <span className="text-emerald-600 dark:text-emerald-400">{c.entregues} entregues</span>
                <span>{c.lidas} lidas</span>
                <span className="text-red-600 dark:text-red-400">{c.falharam} falharam</span>
                <span>{c.a_caminho} a caminho</span>
                <span>{c.pendentes} na fila</span>
                {Number(c.ignorados) > 0 && <span>{c.ignorados} saíram da lista antes do envio</span>}
              </div>
            </div>
          );
        })}

        {campanhas.length === 0 && (
          <p className="rounded-lg border p-6 text-center text-sm"
             style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            Nenhuma campanha ainda.
          </p>
        )}
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--muted)" }}>{rotulo}</p>
      <p className={`text-2xl font-semibold ${cor ?? ""}`}>{valor}</p>
    </div>
  );
}

interface Aviso {
  kind: "ok" | "erro";
  text: string;
}

type MediaKind = "text" | "image" | "video" | "audio" | "document";

const TIPOS: { valor: MediaKind; rotulo: string; accept?: string }[] = [
  { valor: "text", rotulo: "Texto" },
  { valor: "image", rotulo: "Foto", accept: "image/jpeg,image/png,image/webp" },
  { valor: "video", rotulo: "Vídeo", accept: "video/mp4" },
  { valor: "audio", rotulo: "Áudio", accept: "audio/mpeg,audio/ogg,audio/mp4" },
  { valor: "document", rotulo: "Arquivo" },
];

interface Anexo {
  url: string;
  filename: string;
  mime: string;
  bytes: number;
}

/** Duração estimada de uma campanha, em texto de gente. */
function duracao(destinatarios: number, minSeg: number, maxSeg: number, teto: number): string {
  if (destinatarios === 0) return "";
  const porDia = Math.min(destinatarios, teto);
  const segundos = (porDia - 1) * ((minSeg + maxSeg) / 2);
  const horas = segundos / 3600;
  const dias = Math.ceil(destinatarios / teto);

  const hoje = horas < 1 ? `${Math.round(segundos / 60)} min` : `${horas.toFixed(1)} h`;
  return dias > 1
    ? `${porDia} por dia (${hoje} de envio), ${dias} dias no total`
    : `cerca de ${hoje} de envio`;
}

function Formulario({
  channelId,
  onDone,
}: {
  channelId: string;
  onDone: (r: Aviso) => void | Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<MediaKind>("text");
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [quando, setQuando] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagsBase, setTagsBase] = useState<string[]>([]);
  const [alcance, setAlcance] = useState<{ nome: string; tags: string[] }[]>([]);
  const [minSeg, setMinSeg] = useState(45);
  const [maxSeg, setMaxSeg] = useState(120);
  const [teto, setTeto] = useState(150);
  const [inicio, setInicio] = useState("09:00");
  const [fim, setFim] = useState("19:00");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A base enviável serve para dois números que o usuário precisa ver antes de
  // apertar o botão: quantas pessoas recebem e quanto tempo isso leva.
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/audience");
      if (!r.ok) return;
      const j = await r.json();
      const enviaveis = (j.contatos as { name: string; tags: string[] | null; is_sendable: boolean }[])
        .filter((c) => c.is_sendable)
        .map((c) => ({ nome: c.name, tags: c.tags ?? [] }));
      setAlcance(enviaveis);
      setTagsBase([...new Set(enviaveis.flatMap((c) => c.tags))].sort());
    })();
  }, []);

  const destinatarios = tags.length
    ? alcance.filter((c) => c.tags.some((t) => tags.includes(t))).length
    : alcance.length;

  const precisaArquivo = tipo !== "text";
  const aceitaLegenda = tipo !== "text" && tipo !== "audio";

  async function subir(file: File) {
    setSubindo(true);
    setErro(null);
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/campaigns/media", { method: "POST", body: form });
    const j = await r.json();
    setSubindo(false);
    if (!r.ok) {
      setErro(j.error);
      return;
    }
    setAnexo({ url: j.url, filename: j.filename, mime: j.mime, bytes: j.bytes });
  }

  async function salvar() {
    setErro(null);

    if (precisaArquivo && !anexo) {
      setErro("Escolha o arquivo que será enviado.");
      return;
    }
    if (!precisaArquivo && !texto.trim()) {
      setErro("Escreva a mensagem.");
      return;
    }
    if (destinatarios === 0) {
      setErro("Nenhum contato enviável neste filtro.");
      return;
    }

    setSalvando(true);
    const r = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nome,
        channelId,
        mediaKind: tipo,
        body: tipo === "audio" ? undefined : texto.trim() || undefined,
        mediaUrl: anexo?.url,
        mediaFilename: anexo?.filename,
        mediaMime: anexo?.mime,
        scheduledAt: quando ? new Date(quando).toISOString() : undefined,
        tags: tags.length ? tags : undefined,
        intervalMinSeconds: minSeg,
        intervalMaxSeconds: maxSeg,
        dailyLimit: teto,
        windowStart: inicio,
        windowEnd: fim,
      }),
    });
    const j = await r.json();
    setSalvando(false);

    if (!r.ok) {
      setErro(j.error);
      return;
    }
    await onDone({
      kind: "ok",
      text: `Campanha criada para ${j.destinatarios} destinatários.`,
    });
  }

  const rotulo = "text-xs font-medium";
  const campo = "mt-1 w-full rounded-lg border px-3 py-2 text-sm";
  const estilo = { background: "var(--bg)", borderColor: "var(--border)" };

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={rotulo}>Nome da campanha</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Revisão anual — clientes de 2024"
            className={campo}
            style={estilo}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Só aparece aqui no painel; o cliente não vê.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={rotulo}>Tipo</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                onClick={() => {
                  setTipo(t.valor);
                  setAnexo(null);
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  tipo === t.valor ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
                }`}
                style={tipo === t.valor ? undefined : estilo}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
        </div>

        {precisaArquivo && (
          <div className="sm:col-span-2">
            <label className={rotulo}>Arquivo</label>
            <input
              type="file"
              accept={TIPOS.find((t) => t.valor === tipo)?.accept}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subir(f);
              }}
              className={`${campo} file:mr-3 file:rounded file:border-0 file:bg-wa-teal file:px-2 file:py-1 file:text-xs file:text-white`}
              style={estilo}
            />
            {subindo && (
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Enviando arquivo…
              </p>
            )}
            {anexo && (
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                {anexo.filename} · {(anexo.bytes / 1e6).toFixed(1)} MB
              </p>
            )}
          </div>
        )}

        {(tipo === "text" || aceitaLegenda) && (
          <div className="sm:col-span-2">
            <label className={rotulo}>{tipo === "text" ? "Mensagem" : "Legenda (opcional)"}</label>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              placeholder="Olá {nome}, tudo bem?"
              className={`${campo} resize-y font-mono`}
              style={estilo}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              <code>{"{nome}"}</code> vira o primeiro nome do contato. Vale a pena
              usar: mensagem idêntica para centenas de números é o que mais
              chama atenção dos filtros da Meta.
            </p>
          </div>
        )}

        {tipo === "audio" && (
          <p className="text-xs sm:col-span-2" style={{ color: "var(--muted)" }}>
            Áudio no WhatsApp não aceita legenda — vai sozinho, como uma mensagem de voz.
          </p>
        )}

        <div className="sm:col-span-2">
          <label className={rotulo}>Para quem</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              onClick={() => setTags([])}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                tags.length === 0 ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
              }`}
              style={tags.length === 0 ? undefined : estilo}
            >
              Base inteira
            </button>
            {tagsBase.map((t) => (
              <button
                key={t}
                onClick={() =>
                  setTags((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]))
                }
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  tags.includes(t) ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
                }`}
                style={tags.includes(t) ? undefined : estilo}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm">
            <strong>{destinatarios}</strong> contatos receberão
            {destinatarios > 0 && (
              <span style={{ color: "var(--muted)" }}> — {duracao(destinatarios, minSeg, maxSeg, teto)}</span>
            )}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Quem pediu para sair ou falhou num envio anterior já está fora desta conta.
          </p>
        </div>

        <div>
          <label className={rotulo}>Começar em</label>
          <input
            type="datetime-local"
            value={quando}
            onChange={(e) => setQuando(e.target.value)}
            className={campo}
            style={estilo}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Em branco, nasce como rascunho e só sai quando você mandar.
          </p>
        </div>

        <div>
          <label className={rotulo}>Teto por dia</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={teto}
            onChange={(e) => setTeto(Number(e.target.value))}
            className={campo}
            style={estilo}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Número novo aguenta pouco: comece em 50 e suba aos poucos.
          </p>
        </div>

        <div>
          <label className={rotulo}>Intervalo entre envios (segundos)</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={5}
              value={minSeg}
              onChange={(e) => setMinSeg(Number(e.target.value))}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={estilo}
            />
            <span className="text-sm" style={{ color: "var(--muted)" }}>a</span>
            <input
              type="number"
              min={5}
              value={maxSeg}
              onChange={(e) => setMaxSeg(Number(e.target.value))}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={estilo}
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Sorteado a cada mensagem. Cadência fixa é assinatura de robô.
          </p>
        </div>

        <div>
          <label className={rotulo}>Só entre</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={estilo}
            />
            <span className="text-sm" style={{ color: "var(--muted)" }}>e</span>
            <input
              type="time"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={estilo}
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Fora do horário a fila espera. Mensagem de empresa às 3h vira denúncia.
          </p>
        </div>
      </div>

      {erro && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {erro}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void salvar()}
          disabled={salvando || subindo || !nome.trim()}
          className="rounded-lg bg-wa-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {salvando ? "Criando…" : quando ? "Agendar" : "Salvar rascunho"}
        </button>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Depois de disparar não dá para desenviar — dá só para pausar o que falta.
        </p>
      </div>
    </div>
  );
}
