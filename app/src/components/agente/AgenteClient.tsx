"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * As três camadas do prompt, numa tela só.
 *
 * A ordem da tela é a ordem do prompt, de propósito: primeiro o que a
 * plataforma garante e ninguém edita, depois o que esta empresa quer, por
 * último a fila de perguntas. Quem chega aqui precisa entender que o texto
 * que ele escreve entra *abaixo* das regras — e não no lugar delas.
 */

type Perfil = {
  apresentacao: string;
  tom: "informal" | "neutro" | "formal";
  podeExplicar: string;
  nuncaDizer: string;
  quandoEscalar: string;
  horario: string;
  regiao: string;
  observacoes: string;
  atualizadoEm: string | null;
};

type Campo = {
  id: string;
  chave: string;
  pergunta: string;
  tipo: "texto" | "numero";
  position: number;
  is_active: boolean;
  depende_de: string | null;
  depende_valor: string | null;
};

const CAIXA = "rounded-lg border p-4";
const ESTILO_CAIXA = { background: "var(--panel)", borderColor: "var(--border)" } as const;
const ESTILO_CAMPO = { background: "var(--bg)", borderColor: "var(--border)" } as const;

function CampoTexto({
  titulo,
  ajuda,
  valor,
  onChange,
  linhas = 3,
  max,
}: {
  titulo: string;
  ajuda: string;
  valor: string;
  onChange: (v: string) => void;
  linhas?: number;
  max: number;
}) {
  return (
    <label className="mt-4 block first:mt-0">
      <span className="text-sm font-medium">{titulo}</span>
      <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
        {ajuda}
      </p>
      {linhas === 1 ? (
        <input
          value={valor}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
          style={ESTILO_CAMPO}
        />
      ) : (
        <textarea
          value={valor}
          rows={linhas}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
          style={ESTILO_CAMPO}
        />
      )}
      <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
        {valor.length}/{max}
      </span>
    </label>
  );
}

/** Uma pergunta da fila. Salva sozinha, para editar uma não exigir salvar a tela toda. */
function Pergunta({
  campo,
  outras,
  onSalvar,
  onApagar,
  ocupado,
}: {
  campo: Campo;
  outras: Campo[];
  onSalvar: (patch: Record<string, unknown>) => void;
  onApagar: () => void;
  ocupado: boolean;
}) {
  const [pergunta, setPergunta] = useState(campo.pergunta);
  const [tipo, setTipo] = useState(campo.tipo);
  const [dependeDe, setDependeDe] = useState(campo.depende_de ?? "");
  const [dependeValor, setDependeValor] = useState(campo.depende_valor ?? "");

  useEffect(() => {
    setPergunta(campo.pergunta);
    setTipo(campo.tipo);
    setDependeDe(campo.depende_de ?? "");
    setDependeValor(campo.depende_valor ?? "");
  }, [campo]);

  const mudou =
    pergunta.trim() !== campo.pergunta ||
    tipo !== campo.tipo ||
    dependeDe !== (campo.depende_de ?? "") ||
    dependeValor !== (campo.depende_valor ?? "");

  return (
    <div className="mt-3 rounded-lg border p-3" style={ESTILO_CAMPO}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded px-1.5 py-0.5 text-xs" style={{ background: "var(--panel)" }}>
          {campo.chave}
        </code>
        {!campo.is_active && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            Desligada
          </span>
        )}
        <input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          maxLength={200}
          className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "texto" | "numero")}
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <option value="texto">texto</option>
          <option value="numero">número</option>
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span style={{ color: "var(--muted)" }}>Só perguntar se</span>
        <select
          value={dependeDe}
          onChange={(e) => setDependeDe(e.target.value)}
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <option value="">— sempre perguntar —</option>
          {outras
            .filter((o) => o.id !== campo.id)
            .map((o) => (
              <option key={o.id} value={o.chave}>
                {o.chave}
              </option>
            ))}
        </select>
        {dependeDe && (
          <>
            <span style={{ color: "var(--muted)" }}>combinar com</span>
            <input
              value={dependeValor}
              onChange={(e) => setDependeValor(e.target.value)}
              placeholder="cas[ae]|residenc"
              maxLength={200}
              className="w-56 rounded-lg border px-2 py-1 font-mono text-xs"
              style={{ background: "var(--panel)", borderColor: "var(--border)" }}
            />
          </>
        )}

        <span className="ml-auto flex gap-2">
          {mudou && (
            <button
              onClick={() =>
                onSalvar({
                  pergunta: pergunta.trim(),
                  tipo,
                  dependeDe: dependeDe || null,
                  dependeValor: dependeValor || null,
                })
              }
              disabled={ocupado}
              className="rounded-lg bg-wa-teal px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              Salvar
            </button>
          )}
          <button
            onClick={() => onSalvar({ isActive: !campo.is_active })}
            disabled={ocupado}
            className="rounded-lg border px-2 py-1 text-sm disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            {campo.is_active ? "Desligar" : "Ligar"}
          </button>
          <button
            onClick={onApagar}
            disabled={ocupado}
            className="rounded-lg border px-2 py-1 text-sm text-red-600 disabled:opacity-50 dark:text-red-400"
            style={{ borderColor: "var(--border)" }}
          >
            Apagar
          </button>
        </span>
      </div>
    </div>
  );
}

export function AgenteClient() {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [salvo, setSalvo] = useState<Perfil | null>(null);
  const [rendered, setRendered] = useState("");
  const [campos, setCampos] = useState<Campo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [verTexto, setVerTexto] = useState(false);

  const [novaChave, setNovaChave] = useState("");
  const [novaPergunta, setNovaPergunta] = useState("");

  const refresh = useCallback(async () => {
    const [rp, rc] = await Promise.all([fetch("/api/agent/profile"), fetch("/api/agent/fields")]);
    const jp = await rp.json();
    const jc = await rc.json();
    if (!rp.ok) return setErro(jp.error);
    if (!rc.ok) return setErro(jc.error);
    setPerfil(jp.perfil);
    setSalvo(jp.perfil);
    setRendered(jp.rendered);
    setCampos(jc.fields);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mudou = perfil && salvo && JSON.stringify(perfil) !== JSON.stringify(salvo);

  async function salvarPerfil() {
    if (!perfil) return;
    setErro(null);
    setOcupado(true);
    const r = await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(perfil),
    });
    const j = await r.json();
    if (!r.ok) setErro(j.error);
    await refresh();
    setOcupado(false);
  }

  async function chamar(url: string, init: RequestInit) {
    setErro(null);
    setOcupado(true);
    const r = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!r.ok) setErro((await r.json()).error);
    await refresh();
    setOcupado(false);
  }

  async function criarPergunta() {
    // A posição nasce depois da última: pergunta nova quase nunca é a
    // primeira coisa a perguntar.
    const position = (campos.at(-1)?.position ?? 0) + 10;
    await chamar("/api/agent/fields", {
      method: "POST",
      body: JSON.stringify({
        chave: novaChave.trim().toLowerCase(),
        pergunta: novaPergunta.trim(),
        position,
      }),
    });
    setNovaChave("");
    setNovaPergunta("");
  }

  /** Trocar de lugar com a vizinha. A ordem é a ordem em que o bot pergunta. */
  async function mover(indice: number, direcao: -1 | 1) {
    const vizinha = campos[indice + direcao];
    const atual = campos[indice];
    if (!vizinha || !atual) return;
    setOcupado(true);
    setErro(null);
    await fetch(`/api/agent/fields/${atual.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: vizinha.position }),
    });
    await fetch(`/api/agent/fields/${vizinha.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: atual.position }),
    });
    await refresh();
    setOcupado(false);
  }

  const editar = (patch: Partial<Perfil>) => setPerfil((p) => (p ? { ...p, ...patch } : p));

  return (
    <div className="mx-auto max-w-3xl p-6 pb-16">
      <h1 className="text-xl font-semibold">Agente</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Como o atendimento automático desta empresa fala, e o que ele precisa
        descobrir antes de passar a conversa para alguém.
      </p>

      {erro && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {erro}
        </p>
      )}

      {/* Camada 1 — o que ninguém edita. Está na tela para que quem escreve as
          diretrizes saiba com o que elas convivem. */}
      <div className={`mt-6 ${CAIXA}`} style={ESTILO_CAIXA}>
        <p className="font-medium">Regras da plataforma</p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Valem para toda empresa e não são editáveis. Em conflito com o que
          estiver escrito abaixo, elas vencem.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm" style={{ color: "var(--muted)" }}>
          <li>Não afirmar nada sobre a empresa que não esteja na Base.</li>
          <li>Não estimar, não arredondar, não completar com conhecimento geral.</li>
          <li>Chamar uma pessoa em vez de chutar.</li>
          <li>Admitir que é um atendimento automático quando perguntarem.</li>
          <li>Nunca terminar calado: toda mensagem do cliente tem resposta.</li>
          <li>Perguntar uma vez só — o que já foi respondido sai da fila.</li>
        </ul>
      </div>

      {!perfil ? (
        <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
          Carregando…
        </p>
      ) : (
        <>
          {/* Camada 2 */}
          <div className={`mt-4 ${CAIXA}`} style={ESTILO_CAIXA}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">Diretrizes desta empresa</p>
              {perfil.atualizadoEm && (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  alterado em{" "}
                  {new Date(perfil.atualizadoEm).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Campo em branco não entra no prompt. Nada aqui substitui a Base:
              o que o bot pode <em>afirmar</em> continua sendo só o que estiver
              lá.
            </p>

            <div className="mt-4">
              <CampoTexto
                titulo="Sobre a empresa"
                ajuda="Duas linhas: o que ela vende e para quem. É como o bot se situa."
                valor={perfil.apresentacao}
                onChange={(v) => editar({ apresentacao: v })}
                max={1000}
              />

              <label className="mt-4 block">
                <span className="text-sm font-medium">Tom</span>
                <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
                  Vira instrução no prompt, não rótulo.
                </p>
                <select
                  value={perfil.tom}
                  onChange={(e) => editar({ tom: e.target.value as Perfil["tom"] })}
                  className="mt-1.5 rounded-lg border px-3 py-2 text-sm"
                  style={ESTILO_CAMPO}
                >
                  <option value="informal">Informal — próximo, pode usar emoji</option>
                  <option value="neutro">Neutro — cordial e direto</option>
                  <option value="formal">Formal — senhor/senhora, sem emoji</option>
                </select>
              </label>

              <CampoTexto
                titulo="Pode explicar por conta própria"
                ajuda="Assuntos gerais do setor que o bot responde sem estar na Base. Continua proibido citar número, modelo ou valor que não esteja lá."
                valor={perfil.podeExplicar}
                onChange={(v) => editar({ podeExplicar: v })}
                max={1000}
              />

              <CampoTexto
                titulo="Nunca diga"
                ajuda="O que fica fora mesmo que o bot saiba. Preço costuma morar aqui."
                valor={perfil.nuncaDizer}
                onChange={(v) => editar({ nuncaDizer: v })}
                max={1000}
              />

              <CampoTexto
                titulo="Chame uma pessoa também quando"
                ajuda="Situações desta empresa que pedem alguém da equipe, além das que a plataforma já cobre."
                valor={perfil.quandoEscalar}
                onChange={(v) => editar({ quandoEscalar: v })}
                max={1000}
              />

              <CampoTexto
                titulo="Região atendida"
                ajuda="Para o bot não qualificar quem está fora da área."
                valor={perfil.regiao}
                onChange={(v) => editar({ regiao: v })}
                linhas={1}
                max={300}
              />

              <CampoTexto
                titulo="Horário do atendimento humano"
                ajuda="Serve para situar o cliente. O bot nunca promete a hora em que alguém responde."
                valor={perfil.horario}
                onChange={(v) => editar({ horario: v })}
                linhas={1}
                max={200}
              />

              <CampoTexto
                titulo="Outras preferências"
                ajuda="O que não coube nos campos acima. Entra no fim, abaixo das regras da plataforma."
                valor={perfil.observacoes}
                onChange={(v) => editar({ observacoes: v })}
                linhas={4}
                max={2000}
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => void salvarPerfil()}
                disabled={!mudou || ocupado}
                className="rounded-lg bg-wa-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Salvar diretrizes
              </button>
              <button
                onClick={() => setVerTexto((v) => !v)}
                className="text-sm underline"
                style={{ color: "var(--muted)" }}
              >
                {verTexto ? "esconder" : "ver como o agente recebe"}
              </button>
              {mudou && (
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  alterações não salvas
                </span>
              )}
            </div>

            {verTexto && (
              <pre
                className="mt-3 max-h-96 overflow-auto rounded-lg px-3 py-2 text-xs whitespace-pre-wrap"
                style={{ background: "var(--bg)", color: "var(--muted)" }}
              >
                {rendered || "(nada preenchido ainda)"}
              </pre>
            )}
          </div>

          {/* A fila de perguntas */}
          <div className={`mt-4 ${CAIXA}`} style={ESTILO_CAIXA}>
            <p className="font-medium">O que perguntar antes de passar para a equipe</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Uma por mensagem, na ordem abaixo, e nunca duas vezes: o que a
              pessoa responde fica gravado no contato e sai da fila. Ignorada
              duas vezes, a pergunta sai sozinha. Com a fila vazia, o bot chama
              alguém da equipe.
            </p>

            {campos.length === 0 && (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Nenhuma pergunta cadastrada — o bot conversa e passa para a
                equipe sem qualificar.
              </p>
            )}

            {campos.map((campo, i) => (
              <div key={campo.id} className="flex items-start gap-2">
                <div className="mt-6 flex flex-col">
                  <button
                    onClick={() => void mover(i, -1)}
                    disabled={i === 0 || ocupado}
                    className="px-1 text-xs disabled:opacity-30"
                    style={{ color: "var(--muted)" }}
                    aria-label="subir"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => void mover(i, 1)}
                    disabled={i === campos.length - 1 || ocupado}
                    className="px-1 text-xs disabled:opacity-30"
                    style={{ color: "var(--muted)" }}
                    aria-label="descer"
                  >
                    ▼
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <Pergunta
                    campo={campo}
                    outras={campos}
                    ocupado={ocupado}
                    onSalvar={(patch) =>
                      void chamar(`/api/agent/fields/${campo.id}`, {
                        method: "PATCH",
                        body: JSON.stringify(patch),
                      })
                    }
                    onApagar={() =>
                      void chamar(`/api/agent/fields/${campo.id}`, { method: "DELETE" })
                    }
                  />
                </div>
              </div>
            ))}

            <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-medium">Nova pergunta</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={novaChave}
                  onChange={(e) => setNovaChave(e.target.value)}
                  placeholder="chave"
                  maxLength={32}
                  className="w-40 rounded-lg border px-2 py-1 font-mono text-sm"
                  style={ESTILO_CAMPO}
                />
                <input
                  value={novaPergunta}
                  onChange={(e) => setNovaPergunta(e.target.value)}
                  placeholder="o que o bot precisa descobrir"
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm"
                  style={ESTILO_CAMPO}
                />
                <button
                  onClick={() => void criarPergunta()}
                  disabled={ocupado || novaChave.trim().length < 2 || novaPergunta.trim().length < 3}
                  className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                A chave é o nome do dado — <code>cidade</code>,{" "}
                <code>modelo_do_carro</code> — e não muda depois: é com ela que
                a resposta fica gravada no contato. A pergunta é a frase que o
                bot usa para descobrir isso.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
