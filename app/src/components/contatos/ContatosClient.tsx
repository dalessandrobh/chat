"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodificar,
  lerPlanilha,
  normalizarNumero,
  MODELO_CSV,
  type Leitura,
} from "@/lib/planilha";
import {
  EXIGE_CONFIRMACAO,
  FRASE_LIMPAR_BASE,
  fraseConfere,
  MOTIVO_FORA,
} from "@/lib/base-envio";

interface Contato {
  id: string;
  name: string;
  wa_id: string;
  tags: string[];
  group_id: string | null;
  is_sendable: boolean;
  unsendable_reason: string | null;
  unsendable_at: string | null;
}

/**
 * Grupo é onde o contato está; etiqueta é o que ele tem.
 *
 * Por isso é um só por contato, e por isso a lista é curta: se um dia ela
 * ficar longa, o que se queria eram etiquetas. `enviaveis` vem junto porque a
 * pergunta na hora de segmentar não é quantos estão no grupo, é quantos ainda
 * recebem.
 */
interface Grupo {
  id: string;
  nome: string;
  contatos: number;
  enviaveis: number;
}

/** O filtro da lista: todos, sem grupo, ou um grupo. */
type FiltroGrupo = "todos" | "sem" | string;

interface Resumo {
  total: number;
  enviaveis: number;
  fora: number;
  pediramSair: number;
}

type Aviso = { kind: "ok" | "erro"; text: string };

/** Uma pergunta de sim ou não que trava a tela até ser respondida. */
interface Pergunta {
  titulo: string;
  texto: string;
  rotulo: string;
  acao: () => Promise<string>;
}

async function pedir(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Erro ${r.status}`);
  return j;
}

export function ContatosClient() {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ total: 0, enviaveis: 0, fora: 0, pediramSair: 0 });
  const [busca, setBusca] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [painel, setPainel] = useState<"nenhum" | "importar" | "novo" | "limpar" | "grupos">("nenhum");
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [filtro, setFiltro] = useState<FiltroGrupo>("todos");
  const [editando, setEditando] = useState<string | null>(null);
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);

  const refresh = useCallback(async (q = "", grupo: FiltroGrupo = "todos") => {
    try {
      const busca = new URLSearchParams();
      if (q) busca.set("q", q);
      if (grupo !== "todos") busca.set("grupo", grupo);
      const cauda = busca.toString();
      const j = await pedir(`/api/audience${cauda ? `?${cauda}` : ""}`);
      setContatos(j.contatos);
      setResumo(j.resumo);
    } catch (err) {
      setAviso({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  /** Os grupos e as contagens deles, que mudam a cada contato que troca de lugar. */
  const recarregarGrupos = useCallback(async () => {
    try {
      const j = await pedir("/api/groups");
      setGrupos(j.grupos);
    } catch (err) {
      setAviso({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => { void refresh(); void recarregarGrupos(); }, [refresh, recarregarGrupos]);

  const abrir = (qual: typeof painel) =>
    setPainel((atual) => (atual === qual ? "nenhum" : qual));

  async function concluir(texto: string) {
    setAviso({ kind: "ok", text: texto });
    setPainel("nenhum");
    setEditando(null);
    // Os grupos vão junto: quase tudo que muda um contato muda a contagem de
    // algum grupo, e um número velho na tela é pior do que número nenhum.
    await Promise.all([refresh(busca, filtro), recarregarGrupos()]);
  }

  /** Troca o filtro e recarrega: a lista para na linha 500, quem filtra no
   *  servidor vê o grupo inteiro. */
  async function filtrarPor(novo: FiltroGrupo) {
    setFiltro(novo);
    await refresh(busca, novo);
  }

  function falhar(err: unknown) {
    setAviso({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
  }

  // ---------------------------------------------------------------------------

  async function salvar(
    c: Contato,
    mudanca: { name: string; waId: string; tags: string[]; groupId: string | null }
  ) {
    try {
      await pedir(`/api/audience/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      });
      await concluir(`${mudanca.name} atualizado.`);
    } catch (err) {
      falhar(err);
    }
  }

  /**
   * Tirar da lista por decisão da equipe.
   *
   * Pergunta antes porque o efeito é silencioso: o contato continua na tela,
   * só para de receber. Sem a pergunta, um clique errado só apareceria na
   * campanha seguinte, com um destinatário a menos que ninguém procurou.
   */
  function perguntarNaoEnviar(c: Contato) {
    setPergunta({
      titulo: `Parar de enviar para ${c.name}?`,
      texto:
        "Ele sai das próximas campanhas e continua na base, marcado. Não é o " +
        "mesmo que a pessoa ter pedido para sair — isso fica registrado à " +
        "parte. Devolver à lista é um clique.",
      rotulo: "Não enviar",
      acao: async () => {
        await pedir(`/api/audience/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ naoEnviar: true }),
        });
        return `${c.name} não recebe mais campanhas.`;
      },
    });
  }

  function perguntarApagar(c: Contato) {
    const pediuSair = c.unsendable_reason === EXIGE_CONFIRMACAO;
    setPergunta({
      titulo: `Apagar ${c.name}?`,
      texto: pediuSair
        ? "Este contato pediu para não receber mensagens. É a linha dele que " +
          "impede o número de voltar à lista na próxima planilha importada. " +
          "Apagando, essa proteção some junto."
        : "A linha sai da base para sempre, junto com o registro de quais " +
          "campanhas ele recebeu. Não tem desfazer.",
      rotulo: "Apagar contato",
      acao: async () => {
        await pedir(`/api/audience/${c.id}?confirmo=1`, { method: "DELETE" });
        return `${c.name} apagado da base.`;
      },
    });
  }

  function perguntarReativar(c: Contato) {
    const pediuSair = c.unsendable_reason === EXIGE_CONFIRMACAO;
    setPergunta({
      titulo: `Devolver ${c.name} à lista?`,
      texto: pediuSair
        ? "Esta pessoa pediu para não receber mensagens. Devolvê-la à lista " +
          "faz dela alvo das próximas campanhas de novo — só faça isso se ela " +
          "pediu para voltar. Fica anotado quem devolveu e quando."
        : "O contato volta a receber campanhas. Fica anotado quem devolveu e quando.",
      rotulo: "Devolver à lista",
      acao: async () => {
        await pedir(`/api/audience/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reativar: true, confirmo: true }),
        });
        return `${c.name} voltou para a lista de envio.`;
      },
    });
  }

  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Base de envio</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Quem pode receber campanhas.
        </p>
        <button
          onClick={() => abrir("grupos")}
          className="ml-auto rounded-lg border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: "var(--border)" }}
        >
          {painel === "grupos" ? "Fechar" : "Grupos"}
        </button>
        <button
          onClick={() => abrir("novo")}
          className="rounded-lg border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: "var(--border)" }}
        >
          {painel === "novo" ? "Fechar" : "Novo contato"}
        </button>
        <button
          onClick={() => abrir("importar")}
          className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
        >
          {painel === "importar" ? "Fechar" : "Importar planilha"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Cartao rotulo="Na base" valor={resumo.total} />
        <Cartao rotulo="Podem receber" valor={resumo.enviaveis} cor="text-emerald-600 dark:text-emerald-400" />
        <Cartao rotulo="Fora da lista" valor={resumo.fora} cor="text-amber-600 dark:text-amber-400" />
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Quem pede para sair, falha no envio ou não tem WhatsApp fica aqui
        marcado em vez de sumir — é o que impede recadastrar amanhã quem pediu
        para sair hoje. Apagar de vez existe, mas é sempre um pedido seu.
      </p>

      {aviso && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${
          aviso.kind === "ok"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-200"}`}>
          {aviso.text}
        </p>
      )}

      {painel === "grupos" && (
        <Grupos
          grupos={grupos}
          onMudou={async (t) => {
            setAviso({ kind: "ok", text: t });
            // O filtro pode estar apontando para um grupo que acabou de ser
            // apagado; voltar para "todos" evita uma lista vazia sem motivo
            // visível na tela.
            setFiltro("todos");
            await Promise.all([refresh(busca, "todos"), recarregarGrupos()]);
          }}
          onErro={(t) => setAviso({ kind: "erro", text: t })}
        />
      )}

      {painel === "novo" && (
        <NovoContato
          grupos={grupos}
          onOk={(t) => void concluir(t)}
          onErro={(t) => setAviso({ kind: "erro", text: t })}
        />
      )}

      {painel === "importar" && (
        <Importador grupos={grupos} onDone={async (r) => {
          setAviso(r);
          if (r.kind === "ok") {
            setPainel("nenhum");
            await Promise.all([refresh(busca, filtro), recarregarGrupos()]);
          }
        }} />
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => { setBusca(e.target.value); void refresh(e.target.value, filtro); }}
          placeholder="Buscar por nome ou número"
          className="flex-1 min-w-48 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        />
        <select
          value={filtro}
          onChange={(e) => void filtrarPor(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          <option value="todos">Todos os grupos</option>
          <option value="sem">Sem grupo</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>{g.nome} ({g.contatos})</option>
          ))}
        </select>
      </div>

      <div className="mt-4 space-y-1">
        {contatos.map((c) =>
          editando === c.id ? (
            <LinhaEdicao
              key={c.id}
              contato={c}
              grupos={grupos}
              onCancelar={() => setEditando(null)}
              onSalvar={(m) => salvar(c, m)}
            />
          ) : (
            <Linha
              key={c.id}
              contato={c}
              grupo={grupos.find((g) => g.id === c.group_id)?.nome ?? null}
              onEditar={() => setEditando(c.id)}
              onApagar={() => perguntarApagar(c)}
              onReativar={() => perguntarReativar(c)}
              onNaoEnviar={() => perguntarNaoEnviar(c)}
            />
          )
        )}
        {contatos.length === 0 && (
          <p className="rounded-lg border p-6 text-center text-sm"
             style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            {busca ? "Nenhum contato com esse nome ou número." : "Nenhum contato ainda."}
          </p>
        )}
      </div>

      {contatos.length > 0 && resumo.total > contatos.length && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Mostrando os {contatos.length} mais recentes de {resumo.total}. Use a
          busca para achar o resto.
        </p>
      )}

      <div className="mt-10 rounded-lg border border-red-200 p-4 dark:border-red-900/60">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">Limpar a base</p>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Apaga os {resumo.total} contatos desta empresa de uma vez. Não tem desfazer.
        </p>
        {painel === "limpar" ? (
          <LimparBase
            resumo={resumo}
            onCancelar={() => setPainel("nenhum")}
            onOk={(t) => void concluir(t)}
            onErro={(t) => setAviso({ kind: "erro", text: t })}
          />
        ) : (
          <button
            onClick={() => abrir("limpar")}
            disabled={resumo.total === 0}
            className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-300"
          >
            Limpar toda a base
          </button>
        )}
      </div>

      {pergunta && (
        <Confirmacao
          pergunta={pergunta}
          onFechar={() => setPergunta(null)}
          onOk={(t) => { setPergunta(null); void concluir(t); }}
          onErro={(t) => { setPergunta(null); setAviso({ kind: "erro", text: t }); }}
        />
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

// -----------------------------------------------------------------------------
// Uma linha da lista
// -----------------------------------------------------------------------------

function Linha({
  contato: c,
  grupo,
  onEditar,
  onApagar,
  onReativar,
  onNaoEnviar,
}: {
  contato: Contato;
  grupo: string | null;
  onEditar: () => void;
  onApagar: () => void;
  onReativar: () => void;
  onNaoEnviar: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
      style={{
        background: "var(--panel)",
        borderColor: "var(--border)",
        opacity: c.is_sendable ? 1 : 0.7,
      }}
    >
      <span className="font-medium">{c.name}</span>
      <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>{c.wa_id}</span>
      {/* O grupo vem antes das etiquetas e com outra cor: são coisas
          diferentes, e ler as duas como uma lista só desfaria a distinção. */}
      {grupo && (
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
          {grupo}
        </span>
      )}
      {c.tags.map((t) => (
        <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-800">
          {t}
        </span>
      ))}
      {!c.is_sendable && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {MOTIVO_FORA[c.unsendable_reason ?? ""] ?? "Fora da lista"}
        </span>
      )}

      <div className="ml-auto flex items-center gap-3 text-xs">
        {c.is_sendable ? (
          <button onClick={onNaoEnviar} className="underline" style={{ color: "var(--muted)" }}>
            Não enviar
          </button>
        ) : (
          <button onClick={onReativar} className="underline" style={{ color: "var(--muted)" }}>
            Devolver à lista
          </button>
        )}
        <button onClick={onEditar} className="underline" style={{ color: "var(--muted)" }}>
          Editar
        </button>
        <button onClick={onApagar} className="underline text-red-600 dark:text-red-400">
          Apagar
        </button>
      </div>
    </div>
  );
}

function LinhaEdicao({
  contato: c,
  grupos,
  onCancelar,
  onSalvar,
}: {
  contato: Contato;
  grupos: Grupo[];
  onCancelar: () => void;
  onSalvar: (m: {
    name: string;
    waId: string;
    tags: string[];
    groupId: string | null;
  }) => Promise<void>;
}) {
  const [nome, setNome] = useState(c.name);
  const [numero, setNumero] = useState(c.wa_id);
  const [tags, setTags] = useState(c.tags.join(", "));
  const [grupo, setGrupo] = useState(c.group_id ?? "");
  const [busy, setBusy] = useState(false);

  const lido = normalizarNumero(numero);
  const podeSalvar = nome.trim().length > 0 && lido.ok && !busy;

  async function salvar() {
    if (!lido.ok) return;
    setBusy(true);
    await onSalvar({
      name: nome.trim(),
      waId: lido.waId,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      groupId: grupo || null,
    });
    setBusy(false);
  }

  const campo = "rounded-lg border px-2 py-1 text-sm outline-none";
  const estilo = { background: "var(--bg)", borderColor: "var(--border)" };

  return (
    <div className="rounded-lg border px-3 py-2" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${campo} flex-1 min-w-40`} style={estilo} placeholder="Nome" />
        <input value={numero} onChange={(e) => setNumero(e.target.value)} className={`${campo} w-48 font-mono`} style={estilo} placeholder="Número" />
        <input value={tags} onChange={(e) => setTags(e.target.value)} className={`${campo} flex-1 min-w-32`} style={estilo} placeholder="Etiquetas" />
        <select
          value={grupo}
          onChange={(e) => setGrupo(e.target.value)}
          className={`${campo} w-40`}
          style={estilo}
        >
          <option value="">Sem grupo</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>{g.nome}</option>
          ))}
        </select>
        <button
          onClick={() => void salvar()}
          disabled={!podeSalvar}
          className="rounded-lg bg-wa-green px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "Salvando…" : "Salvar"}
        </button>
        <button onClick={onCancelar} className="text-xs underline" style={{ color: "var(--muted)" }}>
          Cancelar
        </button>
      </div>
      <p className="mt-1 text-xs" style={{ color: lido.ok ? "var(--muted)" : undefined }}>
        {lido.ok ? (
          <>
            Vai gravar como <span className="font-mono">{lido.waId}</span>
            {lido.aviso ? ` — ${lido.aviso}` : ""}
          </>
        ) : (
          <span className="text-red-600 dark:text-red-400">{lido.motivo}</span>
        )}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cadastro de um contato
// -----------------------------------------------------------------------------

/**
 * Criar, renomear e apagar grupos.
 *
 * Apagar não pergunta com o mesmo peso de apagar contato porque não é a mesma
 * coisa: os contatos ficam, sem grupo. O que se desfaz é a organização, e a
 * frase do botão diz quantos voltam para "sem grupo" — o número é o que
 * transforma "apagar grupo" em uma decisão informada.
 */
function Grupos({
  grupos,
  onMudou,
  onErro,
}: {
  grupos: Grupo[];
  onMudou: (texto: string) => Promise<void>;
  onErro: (texto: string) => void;
}) {
  const [novo, setNovo] = useState("");
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);

  async function agir(o_que: () => Promise<string>) {
    setBusy(true);
    try {
      await onMudou(await o_que());
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const campo = "rounded-lg border px-2 py-1 text-sm outline-none";
  const estilo = { background: "var(--bg)", borderColor: "var(--border)" };

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <p className="text-sm font-medium">Grupos</p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Onde o contato está — revendedor, consumidor final, indicação. Um por
        contato. O que se acumula são as etiquetas.
      </p>

      <div className="mt-3 space-y-1">
        {grupos.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
            {renomeando === g.id ? (
              <>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={60}
                  className={`${campo} flex-1 min-w-40`}
                  style={estilo}
                />
                <button
                  disabled={busy || nome.trim().length === 0}
                  onClick={() =>
                    void agir(async () => {
                      await pedir(`/api/groups/${g.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ nome: nome.trim() }),
                      });
                      setRenomeando(null);
                      return `Grupo renomeado para ${nome.trim()}.`;
                    })
                  }
                  className="rounded-lg bg-wa-green px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Salvar
                </button>
                <button onClick={() => setRenomeando(null)} className="text-xs underline" style={{ color: "var(--muted)" }}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <span className="font-medium">{g.nome}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {g.contatos} {g.contatos === 1 ? "contato" : "contatos"}
                  {g.contatos > 0 && `, ${g.enviaveis} recebem`}
                </span>
                <div className="ml-auto flex gap-3 text-xs">
                  <button
                    onClick={() => { setRenomeando(g.id); setNome(g.nome); }}
                    className="underline"
                    style={{ color: "var(--muted)" }}
                  >
                    Renomear
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void agir(async () => {
                        const j = await pedir(`/api/groups/${g.id}`, { method: "DELETE" });
                        return j.semGrupoAgora > 0
                          ? `Grupo apagado. ${j.semGrupoAgora} ${j.semGrupoAgora === 1 ? "contato ficou" : "contatos ficaram"} sem grupo.`
                          : "Grupo apagado.";
                      })
                    }
                    className="underline text-red-600 dark:text-red-400"
                  >
                    Apagar
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {grupos.length === 0 && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>Nenhum grupo ainda.</p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && novo.trim()) {
              void agir(async () => {
                await pedir("/api/groups", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ nome: novo.trim() }),
                });
                const criado = novo.trim();
                setNovo("");
                return `Grupo ${criado} criado.`;
              });
            }
          }}
          maxLength={60}
          placeholder="Nome do novo grupo"
          className={`${campo} flex-1`}
          style={estilo}
        />
        <button
          disabled={busy || novo.trim().length === 0}
          onClick={() =>
            void agir(async () => {
              await pedir("/api/groups", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nome: novo.trim() }),
              });
              const criado = novo.trim();
              setNovo("");
              return `Grupo ${criado} criado.`;
            })
          }
          className="rounded-lg bg-wa-green px-4 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Criar
        </button>
      </div>
    </div>
  );
}

function NovoContato({
  grupos,
  onOk,
  onErro,
}: {
  grupos: Grupo[];
  onOk: (texto: string) => void;
  onErro: (texto: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [tags, setTags] = useState("");
  const [grupo, setGrupo] = useState("");
  const [busy, setBusy] = useState(false);

  const lido = normalizarNumero(numero);
  const pronto = nome.trim().length > 0 && lido.ok && !busy;

  async function gravar() {
    if (!lido.ok) return;
    setBusy(true);
    try {
      await pedir("/api/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome.trim(),
          waId: lido.waId,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          ...(grupo && { groupId: grupo }),
        }),
      });
      onOk(`${nome.trim()} entrou na base.`);
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const campo = "w-full rounded-lg border px-3 py-2 text-sm outline-none";
  const estilo = { background: "var(--bg)", borderColor: "var(--border)" };

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <div className="grid gap-2 sm:grid-cols-4">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className={campo} style={estilo} />
        <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="(31) 99999-8888" className={campo} style={estilo} />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Etiquetas, separadas por vírgula" className={campo} style={estilo} />
        <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className={campo} style={estilo}>
          <option value="">Sem grupo</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>{g.nome}</option>
          ))}
        </select>
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        {numero.trim() === "" ? (
          "O número pode vir com parênteses, traços e espaços."
        ) : lido.ok ? (
          <>
            Vai gravar como <span className="font-mono">{lido.waId}</span>
            {lido.aviso ? ` — ${lido.aviso}` : ""}
          </>
        ) : (
          <span className="text-red-600 dark:text-red-400">{lido.motivo}</span>
        )}
      </p>

      <button
        onClick={() => void gravar()}
        disabled={!pronto}
        className="mt-3 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Salvando…" : "Adicionar à base"}
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Limpar a base
// -----------------------------------------------------------------------------

function LimparBase({
  resumo,
  onCancelar,
  onOk,
  onErro,
}: {
  resumo: Resumo;
  onCancelar: () => void;
  onOk: (texto: string) => void;
  onErro: (texto: string) => void;
}) {
  const [frase, setFrase] = useState("");
  const [busy, setBusy] = useState(false);
  const confere = fraseConfere(frase);

  async function limpar() {
    setBusy(true);
    try {
      const j = await pedir("/api/audience", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frase }),
      });
      onOk(`Base limpa: ${j.apagados} contatos apagados.`);
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-red-300 p-4 dark:border-red-900" style={{ background: "var(--panel)" }}>
      <p className="text-sm font-medium text-red-700 dark:text-red-300">
        Apagar os {resumo.total} contatos da base
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs" style={{ color: "var(--muted)" }}>
        <li>Não tem desfazer, e não tem backup dentro do painel.</li>
        <li>
          Some também o histórico de quais campanhas cada um recebeu — os
          números das campanhas antigas mudam.
        </li>
        {resumo.pediramSair > 0 && (
          <li className="text-amber-700 dark:text-amber-400">
            {resumo.pediramSair} {resumo.pediramSair === 1 ? "pessoa pediu" : "pessoas pediram"} para
            não receber mensagens. É a linha delas que impede o número de voltar
            na próxima planilha importada — apagando, essa proteção some.
          </li>
        )}
      </ul>

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Para confirmar, digite: <strong>{FRASE_LIMPAR_BASE}</strong>
      </p>
      <input
        value={frase}
        onChange={(e) => setFrase(e.target.value)}
        placeholder={FRASE_LIMPAR_BASE}
        autoComplete="off"
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void limpar()}
          disabled={!confere || busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Apagando…" : "Apagar tudo"}
        </button>
        <button onClick={onCancelar} className="text-xs underline" style={{ color: "var(--muted)" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Confirmação de um contato só
// -----------------------------------------------------------------------------

function Confirmacao({
  pergunta,
  onFechar,
  onOk,
  onErro,
}: {
  pergunta: Pergunta;
  onFechar: () => void;
  onOk: (texto: string) => void;
  onErro: (texto: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function seguir() {
    setBusy(true);
    try {
      onOk(await pergunta.acao());
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-md rounded-xl border p-5"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold">{pergunta.titulo}</p>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{pergunta.texto}</p>
        <div className="mt-4 flex items-center justify-end gap-3">
          <button onClick={onFechar} className="text-sm underline" style={{ color: "var(--muted)" }}>
            Cancelar
          </button>
          <button
            onClick={() => void seguir()}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : pergunta.rotulo}
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Importação de planilha
// -----------------------------------------------------------------------------

/** A API aceita 5000 por requisição; planilha grande vai em pedaços. */
const LOTE = 2000;

function Importador({
  grupos,
  onDone,
}: {
  grupos: Grupo[];
  onDone: (r: Aviso) => void;
}) {
  const [texto, setTexto] = useState("");
  const [tags, setTags] = useState("");
  /**
   * Grupo da importação inteira.
   *
   * Planilha vem de uma origem só — a lista da feira, a base do revendedor —
   * e é aí que o grupo é sabido. Pedir uma coluna na planilha seria pedir que
   * quem exportou já conhecesse os grupos daqui.
   */
  const [grupo, setGrupo] = useState("");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

  // Reler a cada tecla é barato e evita o pior fluxo possível: importar,
  // descobrir que a coluna errada foi lida, e ter que desfazer no banco.
  function reler(novoTexto: string, novasTags = tagList) {
    setLeitura(novoTexto.trim() ? lerPlanilha(novoTexto, novasTags) : null);
  }

  async function abrir(file: File) {
    const bruto = decodificar(await file.arrayBuffer());
    setArquivo(file.name);
    setTexto(bruto);
    reler(bruto);
  }

  function baixarModelo() {
    // BOM na frente: sem ele o Excel abre o CSV como ASCII e come os acentos.
    const blob = new Blob(["﻿" + MODELO_CSV], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo-contatos.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importar() {
    if (!leitura?.contatos.length) return;
    setBusy(true);

    try {
      let inseridos = 0;
      let ignorados = 0;

      for (let i = 0; i < leitura.contatos.length; i += LOTE) {
        const lote = leitura.contatos.slice(i, i + LOTE);
        const j = await pedir("/api/audience", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contatos: lote.map((c) => ({ name: c.nome, waId: c.waId, tags: c.tags })),
            ...(grupo && { groupId: grupo }),
          }),
        });
        inseridos += j.inseridos;
        ignorados += j.ignorados;
      }

      const partes = [`${inseridos} contatos importados`];
      if (ignorados) partes.push(`${ignorados} já estavam na base e ficaram como estavam`);
      if (leitura.repetidas) partes.push(`${leitura.repetidas} repetidos na planilha`);
      if (leitura.rejeitadas.length) partes.push(`${leitura.rejeitadas.length} linhas sem nome ou número válido`);
      onDone({ kind: "ok", text: partes.join(", ") + "." });
    } catch (err) {
      onDone({ kind: "erro", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const avisos = leitura?.contatos.filter((c) => c.aviso) ?? [];

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => inputArquivo.current?.click()}
          className="rounded-lg bg-wa-teal px-3 py-1.5 text-sm font-medium text-white"
        >
          Escolher planilha
        </button>
        <input
          ref={inputArquivo}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void abrir(f);
          }}
        />
        {arquivo && <span className="text-sm">{arquivo}</span>}
        <button onClick={baixarModelo} className="ml-auto text-xs underline" style={{ color: "var(--muted)" }}>
          Baixar modelo
        </button>
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Salve a planilha como <strong>CSV</strong> (no Excel: Arquivo → Salvar
        como → CSV; no Google Planilhas: Fazer download → CSV). Colunas
        reconhecidas pelo título: nome, telefone/celular/whatsapp e
        etiquetas — em qualquer ordem. Sem título, lê nas três primeiras
        colunas nessa ordem. O número pode vir com parênteses, traços e espaços,
        o DDI 55 é acrescentado quando falta, e o código de operadora no meio
        (o 15, o 41 de <span className="font-mono">55 15 31 99999-8888</span>)
        é removido.
      </p>

      <textarea
        rows={5}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setArquivo(null); reler(e.target.value); }}
        placeholder={"Ou cole aqui:\nMaria Silva; (31) 99999-8888\nJoão Souza; 31 98888-7777"}
        className="mt-3 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      <input
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
          reler(texto, e.target.value.split(",").map((t) => t.trim()).filter(Boolean));
        }}
        placeholder="Etiquetas para todos desta importação (ex.: clientes-2025, bh)"
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      />

      <select
        value={grupo}
        onChange={(e) => setGrupo(e.target.value)}
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      >
        <option value="">Sem grupo</option>
        {grupos.map((g) => (
          <option key={g.id} value={g.id}>Grupo: {g.nome}</option>
        ))}
      </select>

      {leitura && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            {leitura.contatos.length} contatos prontos
            {leitura.temCabecalho ? " (primeira linha lida como título das colunas)" : ""}
          </p>

          {leitura.contatos.length > 0 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-left text-xs">
                <tbody>
                  {leitura.contatos.slice(0, 100).map((c) => (
                    <tr key={c.waId} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-1">{c.nome}</td>
                      <td className="px-2 py-1 font-mono">{c.waId}</td>
                      <td className="px-2 py-1" style={{ color: "var(--muted)" }}>{c.tags.join(", ")}</td>
                      <td className="px-2 py-1 text-amber-700 dark:text-amber-400">{c.aviso ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leitura.contatos.length > 100 && (
                <p className="px-2 py-1 text-xs" style={{ color: "var(--muted)" }}>
                  … e mais {leitura.contatos.length - 100}.
                </p>
              )}
            </div>
          )}

          {avisos.length > 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {avisos.length} número(s) com ressalva. Eles entram assim mesmo — o
              envio confirma na hora se têm WhatsApp.
            </p>
          )}

          {leitura.rejeitadas.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-600 dark:text-red-400">
                {leitura.rejeitadas.length} linha(s) fora
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs" style={{ color: "var(--muted)" }}>
                {leitura.rejeitadas.slice(0, 30).map((r) => (
                  <li key={r.linha}>
                    linha {r.linha}: {r.motivo} — <span className="font-mono">{r.conteudo}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Quem já está na base não é sobrescrito: reimportar a planilha inteira
        não devolve à lista quem pediu para sair.
      </p>

      <button
        onClick={importar}
        disabled={busy || !leitura?.contatos.length}
        className="mt-3 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Importando…" : `Importar ${leitura?.contatos.length ?? 0} contatos`}
      </button>
    </div>
  );
}
