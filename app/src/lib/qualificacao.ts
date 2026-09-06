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
 *
 * E quais são os campos deixou de ser decisão deste arquivo: eles vêm de
 * `chat.qualification_fields`, por empresa. Cravados aqui, uma clínica
 * herdava a fila de uma revendedora de aquecedor solar e perguntava ao
 * paciente quantas pessoas usam o chuveiro.
 */

/** Um campo da fila, como está cadastrado na empresa. */
export type Campo = {
  chave: string;
  pergunta: string;
  tipo: "texto" | "numero";
  /** Chave de outro campo do qual esta pergunta depende. */
  dependeDe?: string | null;
  /** Expressão regular testada contra a resposta daquele campo, sem acento. */
  dependeValor?: string | null;
};

/**
 * O que o agente conseguiu apurar, guardado em `contacts.metadata.qualificacao`.
 *
 * As respostas ficam na raiz, uma por chave cadastrada — é o formato que já
 * estava gravado quando os campos eram fixos, e por isso nada precisou ser
 * migrado. As três chaves de controle abaixo dividem o mesmo objeto, e é por
 * isso que o banco proíbe um campo com esses nomes.
 */
export type Qualificacao = {
  /**
   * Campos que a pessoa não quis responder, ou ignorou. Saem da fila do mesmo
   * jeito que os respondidos: insistir incomoda mais do que a falta do dado
   * atrapalha, e quem assume a conversa pergunta de novo se precisar.
   */
  dispensados?: string[];
  /**
   * Quantas vezes cada campo já foi oferecido ao agente para perguntar. É o
   * freio que não depende de o modelo colaborar: perguntou duas vezes e não
   * veio resposta, o campo sai da fila sozinho.
   */
  tentativas?: Record<string, number>;
  atualizado_em?: string;
  [chave: string]: unknown;
};

/** Nomes que o objeto usa para si e nenhum campo pode tomar. */
export const CHAVES_RESERVADAS = ["dispensados", "tentativas", "atualizado_em"] as const;

/** Quantas vezes o mesmo dado pode ser perguntado antes de a fila desistir dele. */
export const LIMITE_TENTATIVAS = 2;

/** Lê o que está gravado no contato, tolerando metadata de outras origens. */
export function lerQualificacao(metadata: unknown): Qualificacao {
  const bruto = (metadata as { qualificacao?: unknown } | null)?.qualificacao;
  if (!bruto || typeof bruto !== "object") return {};
  return bruto as Qualificacao;
}

/** A resposta gravada de um campo, ou undefined quando ainda não veio. */
export function valorDe(q: Qualificacao, chave: string): string | number | undefined {
  const v = q[chave];
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string" || typeof v === "number") return v;
  return undefined;
}

/** Acento e caixa saem antes de qualquer comparação: o cliente escreve
 *  "residência", "residencia" e "Minha Casa" para dizer a mesma coisa. */
function normalizar(valor: string | number | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Pergunta que depende de outra: só entra na fila quando a resposta daquela
 * bate com o padrão cadastrado. Padrão inválido — alguém digitou uma regex
 * quebrada no painel — derruba a dependência, não a pergunta: some do prompt
 * é pior do que aparecer na hora errada.
 */
export function condicaoAtendida(q: Qualificacao, campo: Campo): boolean {
  if (!campo.dependeDe || !campo.dependeValor) return true;
  const resposta = valorDe(q, campo.dependeDe);
  if (resposta === undefined) return false;
  try {
    return new RegExp(campo.dependeValor, "i").test(normalizar(resposta));
  } catch {
    return true;
  }
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
 *
 * `nome` é a única chave com significado para o código; a empresa que apagar
 * esse campo da fila simplesmente não recebe este atalho.
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
export function primeiroNome(nome: unknown): string {
  return (typeof nome === "string" ? nome : "").trim().split(/\s+/)[0] ?? "";
}

/** O que ainda cabe perguntar, na ordem em que faz sentido perguntar. */
export function faltando(q: Qualificacao, campos: Campo[]): Campo[] {
  const dispensados = new Set(q.dispensados ?? []);
  return campos.filter((campo) => {
    if (valorDe(q, campo.chave) !== undefined) return false;
    if (dispensados.has(campo.chave)) return false;
    if (!condicaoAtendida(q, campo)) return false;
    return true;
  });
}

/**
 * A mesma lista em texto, do jeito que entra no prompt.
 *
 * A chave vai junto da pergunta porque é ela que o agente manda de volta em
 * `anotar_dados`: a ferramenta é a mesma para todas as empresas, então o
 * nome do dado precisa vir do prompt, não do desenho do fluxo.
 */
export function faltandoTexto(q: Qualificacao, campos: Campo[]): string {
  return faltando(q, campos)
    .map((campo) => `- ${campo.chave} — ${campo.pergunta}`)
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
export function registrarTentativa(q: Qualificacao, campos: Campo[]): Qualificacao {
  const pendentes = faltando(q, campos);
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
