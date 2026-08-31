"use client";

import { useCallback, useEffect, useState } from "react";

interface Ajustes {
  lerImagens: boolean;
  atualizadoEm: string | null;
  temChaveImagem: boolean;
  temChaveAudio: boolean;
}

export function AjustesClient() {
  const [ajustes, setAjustes] = useState<Ajustes | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/settings");
    const j = await r.json();
    if (r.ok) setAjustes(j);
    else setErro(j.error);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function alternar(valor: boolean) {
    setErro(null);
    setSalvando(true);
    // Move o botão antes da resposta: a troca é instantânea para quem clica,
    // e o refresh no fim confirma ou desfaz.
    setAjustes((a) => (a ? { ...a, lerImagens: valor } : a));

    const r = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ler_imagens", value: valor }),
    });

    if (!r.ok) setErro((await r.json()).error);
    await refresh();
    setSalvando(false);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Ajustes</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Como o atendimento automático se comporta.
      </p>

      {erro && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {erro}
        </p>
      )}

      {!ajustes ? (
        <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
          Carregando…
        </p>
      ) : (
        <div
          className="mt-6 rounded-lg border p-4"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Ler imagens que o cliente envia</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    ajustes.lerImagens
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  {ajustes.lerImagens ? "Ligado" : "Desligado"}
                </span>
              </div>

              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                Ligado, o bot descreve a foto e responde sobre ela — telhado,
                caixa d&apos;água, print de conversa, documento. Cada imagem custa
                uma consulta ao modelo.
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                Desligado, a imagem recebe a mesma resposta que o vídeo. Em
                qualquer um dos dois casos a conversa <strong>continua com o
                bot</strong> até a pessoa dizer o que quer — quem responde que
                sim é transferido na hora.
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                <strong>Vídeo pergunta sempre</strong>, ligado ou desligado:
                vídeo não é lido em nenhum dos dois casos. É esta a frase que
                sai agora:
              </p>
              <p
                className="mt-2 rounded-lg px-3 py-2 text-sm italic"
                style={{ background: "var(--bg)", color: "var(--muted)" }}
              >
                {ajustes.lerImagens && ajustes.temChaveImagem
                  ? "“Não consigo abrir vídeos por aqui, só consigo ler texto e imagem. Quer que eu chame uma pessoa da equipe para ver esse arquivo com você?”"
                  : "“Não consigo abrir imagens e vídeos por aqui, só consigo ler texto. Quer que eu chame uma pessoa da equipe para ver esse arquivo com você?”"}
              </p>
            </div>

            <button
              onClick={() => void alternar(!ajustes.lerImagens)}
              disabled={salvando}
              className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--border)" }}
            >
              {ajustes.lerImagens ? "Desligar" : "Ligar"}
            </button>
          </div>

          {/* Sem a chave, ligar não muda nada — e o gestor concluiria que o
              painel está quebrado. */}
          {!ajustes.temChaveImagem && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
              Falta <code>ANTHROPIC_API_KEY</code> no painel. Enquanto ela não
              existir, ligar esta opção não tem efeito: a imagem segue para um
              atendente.
            </p>
          )}

          {ajustes.atualizadoEm && (
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              Alterado em{" "}
              {new Date(ajustes.atualizadoEm).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          )}
        </div>
      )}

      {ajustes && (
        <div
          className="mt-4 rounded-lg border p-4"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium">Transcrever áudios</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                ajustes.temChaveAudio
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {ajustes.temChaveAudio ? "Ligado" : "Sem chave"}
            </span>
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {ajustes.temChaveAudio
              ? "Áudio vira texto e o bot responde. Depende de OPENAI_API_KEY, e é por lá que se desliga."
              : "Falta OPENAI_API_KEY no painel. Sem ela, todo áudio vai para um atendente."}
          </p>
        </div>
      )}
    </div>
  );
}
