/**
 * Avisos de troca de turno.
 *
 * Ficam num arquivo só porque são texto de negócio, não lógica: mudar o nome
 * da empresa ou o tom da frase não deveria exigir caçar string espalhada por
 * rotas diferentes.
 *
 * São enviados quando muda quem está do outro lado: bot → humano, humano →
 * bot, e também de um atendente para outro. Reassumir a própria conversa não
 * avisa nada — o cliente receberia a mesma frase duas vezes sem que nada
 * tivesse mudado para ele.
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
 * Quando a conversa troca de atendente.
 *
 * É outra frase porque é outra situação. O cliente já sabe que está com uma
 * pessoa; dizer de novo "agora você está sendo atendido por um ser humano"
 * soaria como se o atendimento tivesse recomeçado do zero.
 */
export function mensagemTrocouDeAtendente(nomeDoAgente: string | null): string {
  return nomeDoAgente?.trim()
    ? `Olá, meu nome é ${nomeDoAgente.trim()} e vou continuar o seu atendimento a partir de agora.`
    : "Outro atendente vai continuar o seu atendimento a partir de agora.";
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
