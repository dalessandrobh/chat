"use client";

/** Cliente Supabase do browser — usado pelo Realtime do inbox. */

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env.public";

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  cached ??= createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    db: { schema: "chat" },
  });
  return cached;
}
