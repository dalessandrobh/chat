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

interface Detalhe {
  media_kind: string;
  body: string | null;
  media_url: string | null;
  media_filename: string | null;
  media_mime: string | null;
  window_start: string;
  window_end: string;
  weekdays: number[];
  exemploNome: string | null;
}

const DIAS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const STATUS: Record<string, { texto: string; cor: string }> = {
  draft:     { texto: "Rascunho",  cor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  scheduled: { texto: "Agendada",  cor: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  running:   { texto: "Enviando",  cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  paused:    { texto: "Pausada",   cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  done:      { texto: "Concluída", cor: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  canceled:  { texto: "Cancelada", cor: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

/** Um canal da empresa, do jeito que a escolha precisa vê-lo. */
export interface CanalDaCampanha {
  id: string;
  name: string;
  connection_state: string | null;
  display_phone_number: string | null;
}

/** O único estado em que o WhatsApp aceita mandar mensagem. */
const CONECTADO = "open";

export function CampanhasClient({ channels }: { channels: CanalDaCampanha[] }) {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<Record<string, Detalhe>>({});
  /** Qual log está aberto: a campanha e o status clicado. */
  const [log, setLog] = useState<{ campanha: string; status: string } | null>(null);
  const [linhas, setLinhas] = useState<LinhaDoLog[] | null>(null);
  const [cortado, setCortado] = useState<{ total: number; limite: number } | null>(null);

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

  // Carrega uma vez e guarda: a lista recarrega a cada 10s, e trafegar o corpo
  // inteiro nesse ritmo, para todas as campanhas, seria pagar caro por algo
  // que quase nunca é olhado. Quem corrige o texto atualiza a cópia guardada
  // na hora, então ela não fica velha por causa deste cache.
  async function verMensagem(id: string) {
    if (aberta === id) {
      setAberta(null);
      return;
    }
    setAberta(id);
    if (detalhes[id]) return;

    const r = await fetch(`/api/campaigns/${id}`);
    const j = await r.json();
    if (!r.ok) {
      setAviso({ kind: "erro", text: j.error });
      setAberta(null);
      return;
    }
    setDetalhes((d) => ({ ...d, [id]: { ...j.campanha, exemploNome: j.exemploNome } }));
  }

  /**
   * Corrige o texto de uma campanha que ainda tem fila.
   *
   * Não é uma edição de rascunho: vale com a campanha correndo. Quem já
   * recebeu recebeu — disso não há volta —, e daqui em diante sai o texto
   * novo, porque a reserva de envio lê o corpo da campanha a cada mensagem.
   */
  async function salvarTexto(id: string, body: string) {
    const r = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const j = await r.json();

    if (!r.ok) {
      setAviso({ kind: "erro", text: j.error });
      return false;
    }

    setDetalhes((d) => ({ ...d, [id]: { ...d[id], body } }));
    setAviso({
      kind: "ok",
      text: "Texto corrigido. Quem ainda está na fila recebe a versão nova.",
    });
    return true;
  }

  /**
   * Abre o log de uma campanha filtrado pelo número que foi clicado.
   *
   * Não guarda em cache como a mensagem: aqui o conteúdo muda a cada envio, e
   * um log velho na tela é pior do que nenhum — quem abriu está tentando
   * entender o que acabou de acontecer.
   */
  async function verLog(campanha: string, status: string) {
    if (log?.campanha === campanha && log.status === status) {
      setLog(null);
      return;
    }
    setLog({ campanha, status });
    setLinhas(null);

    const r = await fetch(`/api/campaigns/${campanha}/recipients?status=${status}`);
    const j = await r.json();
    if (!r.ok) {
      setAviso({ kind: "erro", text: j.error });
      setLog(null);
      return;
    }
    setLinhas(j.destinatarios);
    setCortado({ total: j.total, limite: j.limite });
  }

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
          disabled={channels.length === 0}
          className="ml-auto rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {criando ? "Fechar" : "Nova campanha"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Cartao rotulo="Entregues" valor={total.entregues} cor="text-emerald-600 dark:text-emerald-400" />
        <Cartao rotulo="Falharam" valor={total.falharam} cor="text-red-600 dark:text-red-400" />
        <Cartao rotulo="Na fila" valor={total.pendentes} />
      </div>

      {/* Canal fora do ar é a explicação de campanha inteira falhando, e o
          lugar de dizer isso é antes de criar a próxima, não depois. */}
      {channels.some((c) => c.connection_state !== CONECTADO) && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          {channels.filter((c) => c.connection_state !== CONECTADO).map((c) => c.name).join(", ")}
          {channels.filter((c) => c.connection_state !== CONECTADO).length === 1
            ? " não está conectado"
            : " não estão conectados"}
          . Campanha por um número desconectado falha em todo mundo — reconecte
          em Canais, ou escolha outro número ao criar.
        </p>
      )}

      {aviso && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {aviso.text}
        </p>
      )}

      {criando && channels.length > 0 && (
        <Formulario
          channels={channels}
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
                  <button onClick={() => void verMensagem(c.campaign_id)}
                          className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                    {aberta === c.campaign_id ? "Ocultar mensagem" : "Ver mensagem"}
                  </button>
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

              {aberta === c.campaign_id && (
                <Mensagem
                  detalhe={detalhes[c.campaign_id]}
                  corrigivel={CORRIGIVEL.includes(c.status)}
                  onSalvar={(body) => salvarTexto(c.campaign_id, body)}
                />
              )}

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                <div className="h-full bg-wa-green" style={{ width: `${pct}%` }} />
              </div>

              {/* Cada número abre o log daquele grupo. "A caminho" saiu da
                  fileira: no Baileys a confirmação do WhatsApp pode demorar ou
                  não vir, e um número que não resolve não é informação — quem
                  está nesse estado aparece no log, com a hora do envio. */}
              <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: "var(--muted)" }}>
                <Chip
                  rotulo="entregues"
                  valor={Number(c.entregues)}
                  cor="text-emerald-600 dark:text-emerald-400"
                  ativo={log?.campanha === c.campaign_id && log.status === "delivered"}
                  onClick={() => void verLog(c.campaign_id, "delivered")}
                />
                <Chip
                  rotulo="lidas"
                  valor={Number(c.lidas)}
                  ativo={log?.campanha === c.campaign_id && log.status === "read"}
                  onClick={() => void verLog(c.campaign_id, "read")}
                />
                <Chip
                  rotulo="falharam"
                  valor={Number(c.falharam)}
                  cor="text-red-600 dark:text-red-400"
                  ativo={log?.campanha === c.campaign_id && log.status === "failed"}
                  onClick={() => void verLog(c.campaign_id, "failed")}
                />
                <Chip
                  rotulo="na fila"
                  valor={Number(c.pendentes) + Number(c.a_caminho)}
                  ativo={log?.campanha === c.campaign_id && log.status === "pending"}
                  onClick={() => void verLog(c.campaign_id, "pending")}
                />
                {Number(c.ignorados) > 0 && (
                  <Chip
                    rotulo="saíram da lista antes do envio"
                    valor={Number(c.ignorados)}
                    ativo={log?.campanha === c.campaign_id && log.status === "skipped"}
                    onClick={() => void verLog(c.campaign_id, "skipped")}
                  />
                )}
              </div>

              {log?.campanha === c.campaign_id && (
                <Log linhas={linhas} cortado={cortado} />
              )}
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

/**
 * O que foi enviado, do jeito que a pessoa recebeu.
 *
 * Mostra o texto já com o {nome} resolvido — ver o texto cru não responde a
 * pergunta que se faz olhando uma campanha antiga, que é "o que ela leu". O
 * original fica logo abaixo, quando os dois diferem.
 */
function Mensagem({
  detalhe,
  corrigivel,
  onSalvar,
}: {
  detalhe: Detalhe | undefined;
  corrigivel: boolean;
  onSalvar: (body: string) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!detalhe) {
    return (
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Carregando…
      </p>
    );
  }

  const nome = detalhe.exemploNome ?? "Maria Silva";
  const corpo = detalhe.body ?? "";
  // Áudio não tem legenda: não há texto para corrigir.
  const temTexto = detalhe.media_kind !== "audio";
  const renderizado = corpo.replaceAll("{nome}", nome.split(" ")[0] ?? nome);
  const temPlaceholder = renderizado !== corpo;

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
      {detalhe.media_url && (
        <div className="mb-3">
          {detalhe.media_kind === "image" && (
            <img src={detalhe.media_url} alt={detalhe.media_filename ?? "imagem da campanha"}
                 className="max-h-64 rounded-lg" />
          )}
          {detalhe.media_kind === "video" && (
            <video src={detalhe.media_url} controls className="max-h-64 rounded-lg" />
          )}
          {detalhe.media_kind === "audio" && <audio src={detalhe.media_url} controls className="w-full" />}
          {detalhe.media_kind === "document" && (
            <a href={detalhe.media_url} target="_blank" rel="noopener noreferrer"
               className="text-sm text-wa-teal underline">
              {detalhe.media_filename ?? "arquivo"}
            </a>
          )}
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {detalhe.media_filename} {detalhe.media_mime && `· ${detalhe.media_mime}`}
          </p>
        </div>
      )}

      {editando ? (
        <div>
          <textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            rows={5}
            maxLength={4000}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Quem já recebeu recebeu o texto antigo — isso não volta atrás. A
            fila que falta passa a sair com este.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              disabled={salvando}
              onClick={() => {
                setSalvando(true);
                void onSalvar(rascunho).then((ok) => {
                  setSalvando(false);
                  if (ok) setEditando(false);
                });
              }}
              className="rounded-lg bg-wa-green px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {salvando ? "Salvando…" : "Salvar texto"}
            </button>
            <button
              onClick={() => setEditando(false)}
              className="text-xs underline"
              style={{ color: "var(--muted)" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : corpo ? (
        <>
          <p className="whitespace-pre-wrap text-sm">{renderizado}</p>
          {temPlaceholder && (
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Exemplo com <strong>{nome}</strong>. Texto cadastrado:{" "}
              <code className="whitespace-pre-wrap">{corpo}</code>
            </p>
          )}
        </>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {detalhe.media_kind === "audio" ? "Áudio sem legenda." : "Sem texto."}
        </p>
      )}

      {corrigivel && temTexto && !editando && (
        <button
          onClick={() => { setRascunho(corpo); setEditando(true); }}
          className="mt-3 rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: "var(--border)" }}
        >
          Corrigir texto
        </button>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Envia {DIAS.filter((_, i) => detalhe.weekdays.includes(i)).join(", ")} das{" "}
        {detalhe.window_start.slice(0, 5)} às {detalhe.window_end.slice(0, 5)}.
      </p>
    </div>
  );
}

/** Um número da campanha, que abre o log daquele grupo. */
function Chip({
  rotulo,
  valor,
  cor,
  ativo,
  onClick,
}: {
  rotulo: string;
  valor: number;
  cor?: string;
  ativo: boolean;
  onClick: () => void;
}) {
  // Zero não é clicável: abrir uma lista vazia é responder a pergunta com
  // silêncio, e o número já disse o que tinha a dizer.
  if (valor === 0) {
    return <span className={cor}>{valor} {rotulo}</span>;
  }

  return (
    <button
      onClick={onClick}
      className={`underline underline-offset-2 ${cor ?? ""} ${ativo ? "font-semibold" : ""}`}
      title={ativo ? "Fechar a lista" : `Ver quem ${rotulo}`}
    >
      {valor} {rotulo}
    </button>
  );
}

/** Uma linha do log: um contato, o que aconteceu com ele e quando. */
interface LinhaDoLog {
  id: string;
  name: string;
  wa_id: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
}

const ESTADO: Record<string, string> = {
  pending: "na fila",
  sent: "enviada, sem confirmação",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
  skipped: "saiu da lista antes do envio",
};

/**
 * O log de uma campanha.
 *
 * O erro é o que importa aqui, e por isso ele fica em destaque na linha em vez
 * de escondido num "ver detalhes": campanha que falha inteira falha pelo mesmo
 * motivo, e ler esse motivo uma vez responde a pergunta toda.
 */
function Log({
  linhas,
  cortado,
}: {
  linhas: LinhaDoLog[] | null;
  cortado: { total: number; limite: number } | null;
}) {
  if (!linhas) {
    return (
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>Carregando…</p>
    );
  }

  if (linhas.length === 0) {
    return (
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>Ninguém neste estado.</p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
      {linhas.map((l) => {
        const quando = l.failed_at ?? l.read_at ?? l.delivered_at ?? l.sent_at;
        return (
          <div key={l.id} className="border-b px-3 py-2 text-xs last:border-b-0"
               style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{l.name}</span>
              <span className="font-mono" style={{ color: "var(--muted)" }}>{l.wa_id}</span>
              <span style={{ color: "var(--muted)" }}>{ESTADO[l.status] ?? l.status}</span>
              {quando && (
                <span className="ml-auto" style={{ color: "var(--muted)" }}>
                  {new Date(quando).toLocaleString("pt-BR")}
                </span>
              )}
            </div>
            {l.error && (
              <p className="mt-1 text-red-600 dark:text-red-400">
                {l.error}
                {l.status === "pending" && " — voltou para a fila; retome depois de resolver."}
              </p>
            )}
          </div>
        );
      })}

      {cortado && cortado.total > cortado.limite && (
        <p className="px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
          Mostrando {cortado.limite} de {cortado.total}.
        </p>
      )}
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

/**
 * Onde ainda existe fila para uma correção de texto alcançar.
 *
 * A mesma lista mora em `/api/campaigns/:id`, que é quem manda: aqui ela só
 * decide se o botão aparece. Campanha encerrada ou cancelada não tem o que
 * corrigir — não sobrou ninguém para receber a versão nova.
 */
const CORRIGIVEL = ["draft", "scheduled", "running", "paused"];

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
  channels,
  onDone,
}: {
  channels: CanalDaCampanha[];
  onDone: (r: Aviso) => void | Promise<void>;
}) {
  /**
   * Começa no primeiro canal conectado, e não no primeiro da lista.
   *
   * Com um número só a escolha não existia e a tela pegava o que viesse. Com
   * dois, "o que viesse" virou uma campanha inteira saindo pelo número
   * desconectado — cinco contatos, cinco falhas, seis minutos.
   */
  const [channelId, setChannelId] = useState(
    () => (channels.find((c) => c.connection_state === CONECTADO) ?? channels[0]).id
  );
  const canal = channels.find((c) => c.id === channelId) ?? channels[0];
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<MediaKind>("text");
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [quando, setQuando] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagsBase, setTagsBase] = useState<string[]>([]);
  /** Grupos escolhidos. Vazio quer dizer "todos os grupos". */
  const [gruposEscolhidos, setGruposEscolhidos] = useState<string[]>([]);
  /** "Sem grupo" é um recorte de verdade: quem entrou na última planilha. */
  const [semGrupo, setSemGrupo] = useState(false);
  const [grupos, setGrupos] = useState<{ id: string; nome: string }[]>([]);
  const [alcance, setAlcance] = useState<
    { nome: string; tags: string[]; grupo: string | null }[]
  >([]);
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
      const enviaveis = (
        j.contatos as {
          name: string;
          tags: string[] | null;
          group_id: string | null;
          is_sendable: boolean;
        }[]
      )
        .filter((c) => c.is_sendable)
        .map((c) => ({ nome: c.name, tags: c.tags ?? [], grupo: c.group_id }));
      setAlcance(enviaveis);
      setTagsBase([...new Set(enviaveis.flatMap((c) => c.tags))].sort());

      const g = await fetch("/api/groups");
      if (g.ok) setGrupos((await g.json()).grupos);
    })();
  }, []);

  /**
   * A mesma conta que `chat.enqueue_campaign` faz no banco: grupo e etiqueta
   * se somam com E.
   *
   * Repetida aqui de propósito — o número precisa aparecer enquanto a pessoa
   * escolhe, antes de existir campanha para consultar. Quem manda é o banco;
   * isto é a prévia, e por isso a tela mostra depois quantos entraram de fato.
   */
  const filtraGrupo = gruposEscolhidos.length > 0 || semGrupo;
  const destinatarios = alcance.filter((c) => {
    if (tags.length && !c.tags.some((t) => tags.includes(t))) return false;
    if (!filtraGrupo) return true;
    if (semGrupo && c.grupo === null) return true;
    return c.grupo !== null && gruposEscolhidos.includes(c.grupo);
  }).length;

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
        groupIds: gruposEscolhidos.length ? gruposEscolhidos : undefined,
        semGrupo: semGrupo || undefined,
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
        {channels.length > 1 && (
          <div className="sm:col-span-2">
            <label className={rotulo}>Enviar pelo número</label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className={campo}
              style={estilo}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.display_phone_number ? ` · ${c.display_phone_number}` : ""}
                  {c.connection_state === CONECTADO ? "" : " · desconectado"}
                </option>
              ))}
            </select>
          </div>
        )}

        {canal.connection_state !== CONECTADO && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2 dark:bg-amber-950/60 dark:text-amber-200">
            <strong>{canal.name}</strong> não está conectado. Enviando por ele,
            a campanha para no primeiro contato e se pausa sozinha — ninguém
            recebe. Reconecte em Canais antes de disparar.
          </p>
        )}

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

          {/* Grupo e etiqueta em linhas separadas porque não são a mesma
              pergunta: grupo é onde a pessoa está, etiqueta é o que ela tem, e
              os dois se somam com E. Misturados numa fileira só, a conta que
              o número em baixo faz não teria como ser adivinhada. */}
          {(grupos.length > 0 || semGrupo) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: "var(--muted)" }}>Grupo:</span>
              <button
                onClick={() => { setGruposEscolhidos([]); setSemGrupo(false); }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  !filtraGrupo ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
                }`}
                style={!filtraGrupo ? undefined : estilo}
              >
                Todos
              </button>
              {grupos.map((g) => (
                <button
                  key={g.id}
                  onClick={() =>
                    setGruposEscolhidos((v) =>
                      v.includes(g.id) ? v.filter((x) => x !== g.id) : [...v, g.id]
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    gruposEscolhidos.includes(g.id) ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
                  }`}
                  style={gruposEscolhidos.includes(g.id) ? undefined : estilo}
                >
                  {g.nome}
                </button>
              ))}
              <button
                onClick={() => setSemGrupo((v) => !v)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  semGrupo ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
                }`}
                style={semGrupo ? undefined : estilo}
              >
                Sem grupo
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {grupos.length > 0 && (
              <span className="text-xs" style={{ color: "var(--muted)" }}>Etiqueta:</span>
            )}
            <button
              onClick={() => setTags([])}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                tags.length === 0 ? "border-wa-teal bg-wa-teal/10 font-medium" : ""
              }`}
              style={tags.length === 0 ? undefined : estilo}
            >
              {grupos.length > 0 ? "Todas" : "Base inteira"}
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
