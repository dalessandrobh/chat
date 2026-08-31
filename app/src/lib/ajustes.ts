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

/**
 * Na dúvida, ligado. Um erro de banco não pode virar "o bot parou de ler
 * imagem" sem ninguém ter pedido — o efeito visível seria idêntico ao da
 * chave desligada de propósito, e ninguém desconfiaria.
 */
export async function lerImagensLigado(): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("settings")
    .select("value")
    .eq("key", AJUSTES.lerImagens)
    .maybeSingle();

  if (error) {
    console.error("[ajustes] não consegui ler ler_imagens", error);
    return true;
  }

  return data?.value !== false;
}
