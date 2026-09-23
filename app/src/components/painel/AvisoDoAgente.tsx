/**
 * A faixa que conta que o atendimento automático está fora do ar.
 *
 * Fica entre o cabeçalho e o conteúdo, em toda tela do painel, e não sai dali
 * enquanto o bot não voltar a responder — não tem botão de fechar de
 * propósito: cliente esperando resposta que não vem é o tipo de coisa que não
 * pode depender de alguém lembrar.
 *
 * Só administrador vê. Quem atende não tem o que fazer com a informação, e a
 * faixa roubaria a tela de quem está no meio de uma conversa.
 */

export interface FalhaDoAgente {
  motivo: string;
  /** O que o servidor viu: contagem de conversas paradas, ou o erro do provedor. */
  detalhe: string | null;
  primeira_em: string;
  ultima_em: string;
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AvisoDoAgente({ falha }: { falha: FalhaDoAgente }) {
  return (
    <div
      role="alert"
      className="shrink-0 border-b px-3 py-2 text-xs md:px-5"
      style={{
        borderColor: "var(--border)",
        background: "rgb(180 83 9 / 0.12)",
        color: "var(--fg)",
      }}
    >
      <span className="font-semibold">{falha.motivo}</span>{" "}
      <span style={{ color: "var(--muted)" }}>
        Desde {quando(falha.primeira_em)}, visto pela última vez às{" "}
        {quando(falha.ultima_em)}. Os clientes continuam esperando: responda à
        mão enquanto isso. Este aviso some sozinho quando o bot voltar a
        responder.
      </span>
      {falha.detalhe && (
        <span className="mt-1 block font-mono text-[11px]" style={{ color: "var(--muted)" }}>
          {falha.detalhe}
        </span>
      )}
    </div>
  );
}
