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
} as const;

/** Como cada ajuste se comporta quando a empresa nunca mexeu nele. */
const PADRAO: Record<string, boolean> = {
  [AJUSTES.lerImagens]: true,
};

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
