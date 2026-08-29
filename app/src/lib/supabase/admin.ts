/**
 * Cliente Supabase com service_role — ignora RLS.
 *
 * Use SÓ em rotas de servidor (webhook da Meta, API interna do n8n).
 * Nunca importe isto de um Client Component: vazaria a chave para o browser.
 */

import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

function createChatClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceKey, {
    // Todo o projeto vive no schema `chat`, não no `public`.
    db: { schema: "chat" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "chat-painel" } },
  });
}

// Inferimos o tipo em vez de anotar SupabaseClient: o genérico do schema
// (`chat`) faz parte do tipo e não bate com o default `public`.
let cached: ReturnType<typeof createChatClient> | null = null;

export function supabaseAdmin() {
  cached ??= createChatClient();
  return cached;
}
