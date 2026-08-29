/**
 * Config que pode ir para o browser.
 *
 * Mora num arquivo separado de propósito. Um Client Component que importe
 * qualquer coisa de `@/lib/env` arrasta o módulo inteiro para o bundle, e a
 * primeira linha de `serverEnv` exige SUPABASE_SERVICE_ROLE_KEY — que não
 * existe no browser. O resultado é o módulo estourar ao carregar e a página
 * inteira morrer com "client-side exception", sem pista nenhuma de onde veio.
 *
 * Regra: componente cliente importa daqui, nunca de @/lib/env.
 */

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
} as const;
