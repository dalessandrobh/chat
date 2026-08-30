/**
 * Formato de arquivo da base de conhecimento.
 *
 * Exportar e importar leem daqui, do mesmo lugar, porque um formato descrito
 * em dois códigos diferentes diverge — e a divergência só aparece no dia em
 * que alguém tenta reimportar o que exportou meses antes.
 *
 * Markdown de propósito: o arquivo precisa ser legível por uma pessoa, por
 * uma LLM e pelo parser abaixo, os três sem esforço. O que separa instrução
 * de conteúdo é uma linha marcadora — assim as instruções ficam visíveis para
 * quem (ou o que) for editar o arquivo, em vez de escondidas num comentário.
 */

export interface KnowledgeSection {
  title: string;
  content: string;
  isActive: boolean;
}

export const MARCADOR = "===== INÍCIO DA BASE =====";

/**
 * Teto recomendado, em caracteres do conteúdo ativo.
 *
 * Não é limite técnico: é a conta. A base viaja no prompt a CADA mensagem,
 * então cada caractere aqui é custo recorrente, não espaço em disco.
 */
export const LIMITE_RECOMENDADO = 12000;

/** Aproximação boa o suficiente para português. */
export const CHARS_POR_TOKEN = 3.7;

// -----------------------------------------------------------------------------
// Escrita
// -----------------------------------------------------------------------------

function instrucoes(charsAtivos: number): string {
  const tokens = Math.round(charsAtivos / CHARS_POR_TOKEN);
  const porMensagem = (tokens / 1_000_000) * 2; // Sonnet 5: US$ 2 / 1M tokens de entrada
  const limiteTokens = Math.round(LIMITE_RECOMENDADO / CHARS_POR_TOKEN);
  const limiteCusto = (limiteTokens / 1_000_000) * 2;

  return `# Base de conhecimento — atendimento no WhatsApp

Este arquivo é o que o agente sabe sobre o negócio. Ele é enviado INTEIRO ao
modelo a cada mensagem de cliente. Editar este arquivo e reimportá-lo no painel
muda o que o agente responde a partir da mensagem seguinte — não existe treino,
não existe espera.

## Como usar com outra LLM

Cole este arquivo inteiro num chat e peça o que você quer, por exemplo:

> Abaixo está a base de conhecimento do meu atendimento automático.
> Reescreva a seção "Perguntas frequentes" com respostas mais curtas e
> acrescente cinco perguntas que clientes de aquecimento solar costumam fazer.
> Devolva o arquivo inteiro, no mesmo formato, sem inventar preço, prazo,
> garantia ou qualquer número que não esteja no texto original.

Depois salve a resposta como .md e importe no painel, em Base → Importar.

## Regras do formato

1. Tudo acima da linha marcadora é instrução e é DESCARTADO na importação.
   O que vale começa depois de:

       ${MARCADOR}

2. Cada seção começa com um título de nível 2 e um estado entre colchetes:

       ## [ligada] Região de atendimento
       ## [desligada] Preços

   \`[ligada]\` entra no prompt. \`[desligada]\` fica guardada e não é lida.
   Sem os colchetes, a seção é importada desligada.

3. O conteúdo é o texto entre um título e o próximo. Texto puro, sem
   formatação obrigatória — escreva como explicaria a um atendente novo.

4. A ordem das seções no arquivo é a ordem em que elas chegam ao modelo.

5. Não use \`##\` dentro do conteúdo: o parser leria como início de seção.

## Limite de tamanho

**Mantenha o conteúdo LIGADO abaixo de ${LIMITE_RECOMENDADO.toLocaleString("pt-BR")} caracteres**
(cerca de ${limiteTokens.toLocaleString("pt-BR")} tokens, ~US$ ${limiteCusto.toFixed(3)} por mensagem,
ou ~US$ ${(limiteCusto * 1000).toFixed(0)} a cada mil mensagens).

Agora: ${charsAtivos.toLocaleString("pt-BR")} caracteres ligados, ~${tokens.toLocaleString("pt-BR")} tokens, ~US$ ${porMensagem.toFixed(4)} por mensagem.

Seção desligada não custa nada — só o que está ligado viaja. Se uma LLM
devolver um arquivo muito maior, corte antes de importar: dobrar a base dobra
o custo de toda mensagem, inclusive as que nada têm a ver com o que você
acrescentou.

Texto longo também piora a resposta. Cinco linhas exatas valem mais que trinta
linhas genéricas — o modelo tem menos onde se perder.

## O que NÃO colocar

- Preço, prazo ou garantia que você não confirmou. O agente trata tudo que
  está aqui como verdade e responde sem hesitar.
- Dado de cliente. Isto vai para o modelo a cada mensagem.
- Instrução de comportamento ("seja simpático", "não fale de preço"). Isso
  mora no prompt do agente, não na base.

${MARCADOR}
`;
}

export function serialize(sections: KnowledgeSection[]): string {
  const charsAtivos = sections
    .filter((s) => s.isActive)
    .reduce((total, s) => total + s.title.length + s.content.length + 4, 0);

  const corpo = sections
    .map((s) => `## [${s.isActive ? "ligada" : "desligada"}] ${s.title}\n\n${s.content.trim()}`)
    .join("\n\n");

  return `${instrucoes(charsAtivos)}\n${corpo}\n`;
}

// -----------------------------------------------------------------------------
// Leitura
// -----------------------------------------------------------------------------

export interface ParseResult {
  sections: KnowledgeSection[];
  /** Problemas que não impedem a importação, mas o usuário precisa ver. */
  avisos: string[];
}

const TITULO = /^##\s*(?:\[\s*(ligada|desligada)\s*\]\s*)?(.+?)\s*$/i;

export function parse(texto: string): ParseResult {
  const avisos: string[] = [];

  // As instruções são descartadas. Arquivo sem marcador ainda é aceito: uma
  // LLM pode devolver só as seções, e recusar por isso seria pedantismo.
  const corte = texto.indexOf(MARCADOR);
  const corpo = corte >= 0 ? texto.slice(corte + MARCADOR.length) : texto;
  if (corte < 0) {
    avisos.push(
      "O arquivo não tem a linha marcadora; li o conteúdo inteiro como base."
    );
  }

  const sections: KnowledgeSection[] = [];
  let atual: KnowledgeSection | null = null;
  const buffer: string[] = [];

  const fechar = () => {
    if (!atual) return;
    atual.content = buffer.join("\n").trim();
    if (atual.content) sections.push(atual);
    else avisos.push(`A seção "${atual.title}" veio vazia e foi ignorada.`);
    buffer.length = 0;
  };

  for (const linha of corpo.split(/\r?\n/)) {
    const m = linha.match(TITULO);
    if (m) {
      fechar();
      if (!m[1]) {
        avisos.push(`"${m[2]}" veio sem [ligada]/[desligada]; entrou desligada.`);
      }
      atual = {
        title: m[2].slice(0, 120),
        content: "",
        isActive: m[1]?.toLowerCase() === "ligada",
      };
    } else if (atual) {
      buffer.push(linha);
    }
  }
  fechar();

  return { sections, avisos };
}
