/**
 * Os dados que a equipe precisa antes de assumir a conversa.
 *
 * Por que isto virou uma tabela e não uma lista no prompt: antes a lista
 * morava dentro do systemMessage e o agente relia a conversa inteira a cada
 * mensagem para adivinhar o que já tinha perguntado. Quando o cliente
 * ignorava, o dado continuava faltando — e a pergunta voltava idêntica no
 * turno seguinte, cinco vezes seguidas num teste de dez mensagens.
 *
 * Agora o que foi respondido sai da fila de verdade: fica gravado no contato,
 * e o prompt recebe só o que ainda falta. "Perguntar uma vez" deixa de ser um
 * pedido ao modelo e passa a ser uma consequência do que está gravado.
 */

/** O que o agente conseguiu apurar, guardado em `contacts.metadata.qualificacao`. */
export type Qualificacao = {
  nome?: string;
  cidade?: string;
  uso?: string;
  pessoas?: number;
  /**
   * Campos que a pessoa não quis responder, ou ignorou. Saem da fila do mesmo
   * jeito que os respondidos: insistir incomoda mais do que a falta do dado
   * atrapalha, e quem assume a conversa pergunta de novo se precisar.
   */
  dispensados?: CampoQualificacao[];
  /**
   * Quantas vezes cada campo já foi oferecido ao agente para perguntar. É o
   * freio que não depende de o modelo colaborar: perguntou duas vezes e não
   * veio resposta, o campo sai da fila sozinho.
   */
  tentativas?: Partial<Record<CampoQualificacao, number>>;
  atualizado_em?: string;
};

/** Quantas vezes o mesmo dado pode ser perguntado antes de a fila desistir dele. */
export const LIMITE_TENTATIVAS = 2;

export const CAMPOS = [
  { chave: "nome", pergunta: "o nome da pessoa" },
  { chave: "cidade", pergunta: "em que cidade o aquecedor vai ser instalado" },
  { chave: "uso", pergunta: "se é para casa, piscina ou empresa" },
  {
    chave: "pessoas",
    pergunta: "quantas pessoas usam o chuveiro",
    /** Só faz sentido em residência: piscina e empresa se dimensionam por outra conta. */
    quando: (q: Qualificacao) => ehCasa(q.uso),
  },
] as const;

export type CampoQualificacao = (typeof CAMPOS)[number]["chave"];

export const CHAVES = CAMPOS.map((c) => c.chave) as readonly CampoQualificacao[];

/** O modelo escreve "casa", "residência", "minha residencia" — tudo a mesma
 *  coisa. O acento sai antes da comparação: sem isso "residência" não casa
 *  com "residenc" e o campo `pessoas` nunca entra na fila. */
export function ehCasa(uso: string | undefined): boolean {
  const semAcento = (uso ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /cas[ae]|residenc/i.test(semAcento);
}

/** Lê o que está gravado no contato, tolerando metadata de outras origens. */
export function lerQualificacao(metadata: unknown): Qualificacao {
  const bruto = (metadata as { qualificacao?: unknown } | null)?.qualificacao;
  if (!bruto || typeof bruto !== "object") return {};
  return bruto as Qualificacao;
}

/**
 * O WhatsApp entrega o nome do perfil junto de toda mensagem. Perguntar "como
 * você se chama?" para quem chegou identificado faz o atendimento parecer um
 * formulário — a pessoa sabe que o nome dela aparece do outro lado, ela mesma
 * escolheu esse nome.
 *
 * Então o nome do perfil entra na qualificação como resposta: sai da fila e
 * chega ao agente para ser usado. Quem se apresentar com outro nome depois
 * grava por cima pelo `anotar_dados` — o nome que a pessoa diz vence o do
 * perfil, que às vezes é um apelido ou o nome da loja.
 */
export function comNomeDoPerfil(
  q: Qualificacao,
  perfil: string | null | undefined
): Qualificacao {
  if (q.nome != null) return q;
  const nome = (perfil ?? "").trim();
  // Perfil sem nome chega vazio, ou com o próprio número. Nenhum dos dois
  // serve para chamar alguém: aí a pergunta continua valendo.
  if (nome.length < 2 || !/\p{L}/u.test(nome)) return q;
  return { ...q, nome };
}

/** Como chamar a pessoa numa frase. "Mary Queiroz" vira "Mary": ninguém é
 *  chamado pelo nome completo no WhatsApp. */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] ?? "";
}

/** O que ainda cabe perguntar, na ordem em que faz sentido perguntar. */
export function faltando(q: Qualificacao): { chave: CampoQualificacao; pergunta: string }[] {
  const dispensados = new Set(q.dispensados ?? []);
  return CAMPOS.filter((campo) => {
    if (q[campo.chave] !== undefined && q[campo.chave] !== null) return false;
    if (dispensados.has(campo.chave)) return false;
    if ("quando" in campo && !campo.quando(q)) return false;
    return true;
  }).map((campo) => ({ chave: campo.chave, pergunta: campo.pergunta }));
}

/** A mesma lista em texto, do jeito que entra no prompt. */
export function faltandoTexto(q: Qualificacao): string {
  return faltando(q)
    .map((campo) => `- ${campo.pergunta}`)
    .join("\n");
}

/**
 * Marca que o campo do topo da fila foi oferecido ao agente mais uma vez, e
 * o descarta quando o limite estoura.
 *
 * Fica aqui, e não no prompt, porque "não repita" só funciona quando alguém
 * conta. O modelo não conta: relê a conversa, vê o dado faltando e pergunta
 * de novo, indefinidamente.
 */
export function registrarTentativa(q: Qualificacao): Qualificacao {
  const pendentes = faltando(q);
  if (pendentes.length === 0) return q;

  const alvo = pendentes[0].chave;
  const tentativas = { ...(q.tentativas ?? {}), [alvo]: (q.tentativas?.[alvo] ?? 0) + 1 };
  const estourou = (tentativas[alvo] ?? 0) > LIMITE_TENTATIVAS;

  return {
    ...q,
    tentativas,
    ...(estourou && { dispensados: [...new Set([...(q.dispensados ?? []), alvo])] }),
  };
}
