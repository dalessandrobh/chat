/**
 * Cliente Supabase para Server Components e Route Handlers.
 * Herda a sessão do agente logado via cookies, então a RLS se aplica.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    db: { schema: "chat" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components não podem escrever cookies. O middleware já
          // renova a sessão, então ignorar aqui é seguro.
        }
      },
    },
  });
}
