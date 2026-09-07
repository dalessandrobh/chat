"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Entrega o token da sessão ao Realtime antes de qualquer join.
 *
 * A inscrição de postgres_changes é registrada no servidor com as claims que
 * vierem no join, e um join feito com a chave anônima fica preso nelas: os
 * eventos continuam chegando, mas vazios e marcados "Error 401: Unauthorized",
 * porque `anon` não enxerga o schema chat. Como a sessão do navegador é lida
 * de forma assíncrona, sem este await o join sai antes dela em toda carga de
 * página — e a tela para de se atualizar sem nenhum erro visível.
 */
export async function autenticarRealtime(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
}
