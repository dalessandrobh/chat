/**
 * Avisos de troca de turno.
 *
 * Ficam num arquivo só porque são texto de negócio, não lógica: mudar o nome
 * da empresa ou o tom da frase não deveria exigir caçar string espalhada por
 * rotas diferentes.
 *
 * São enviados apenas na troca de verdade — bot → humano e humano → bot.
 * Reassumir uma conversa que já está com humano não avisa nada: o cliente
 * receberia a mesma frase duas vezes sem nada ter mudado para ele.
 */

/** Quando um atendente assume pelo painel. */
export function mensagemAssumiu(nomeDoAgente: string | null): string {
  const inicio = "A partir de agora você está sendo atendido por um ser humano.";
  // Sem nome cadastrado, apresentar-se como "meu nome é null" seria pior que
  // não se apresentar.
  return nomeDoAgente?.trim()
    ? `${inicio} Olá, meu nome é ${nomeDoAgente.trim()}.`
    : inicio;
}

/**
 * Quando o atendente devolve a conversa.
 *
 * O nome vem de quem chama, não de uma constante: com várias empresas no mesmo
 * painel, um nome cravado aqui faria o cliente de uma ouvir o nome da outra.
 */
export function mensagemDevolveu(empresa: string): string {
  return `A partir de agora você está sendo atendido pelo atendimento automatizado da ${empresa}.`;
}
