/**
 * Ajustes de operação, guardados em `chat.settings`.
 *
 * O que mora aqui é decisão de quem paga a conta, não de quem escreve o
 * código: ler a imagem que o cliente manda custa por mensagem, e desligar
 * isso não pode depender de um deploy.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const AJUSTES = {
  lerImagens: "ler_imagens",
  /** Minutos parados em atendimento humano até a conversa voltar ao bot. */
  devolverAoBot: "devolver_ao_bot_minutos",
  /** Minutos sem ninguém falar até a conversa ser arquivada. */
  encerrarApos: "encerrar_apos_minutos",
} as const;

/** Como cada ajuste se comporta quando a empresa nunca mexeu nele. */
const PADRAO: Record<string, boolean> = {
  [AJUSTES.lerImagens]: true,
};

/**
 * Prazos nascem desligados. Ligar um relógio que mexe em conversa de cliente
 * sem alguém ter pedido é pior do que não ter o relógio.
 */
export const PRAZO_DESLIGADO = 0;

/**
 * Na dúvida, ligado. Um erro de banco não pode virar "o bot parou de ler
 * imagem" sem ninguém ter pedido — o efeito visível seria idêntico ao da
 * chave desligada de propósito, e ninguém desconfiaria.
 */
export async function lerImagensLigado(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("settings")
    .select("value")
    // Sem a empresa isto lia a linha de qualquer uma: esta rota usa a chave de
    // serviço, que ignora a RLS. Com duas empresas seria a de uma decidindo
    // pela outra — ou erro por trazer duas linhas.
    .eq("company_id", companyId)
    .eq("key", AJUSTES.lerImagens)
    .maybeSingle();

  if (error) {
    console.error("[ajustes] não consegui ler ler_imagens", error);
    return PADRAO[AJUSTES.lerImagens];
  }

  // Empresa que nunca mexeu não tem linha, e isso não é "desligado".
  if (!data) return PADRAO[AJUSTES.lerImagens];

  return data.value !== false;
}
