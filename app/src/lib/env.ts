/**
 * Variáveis de ambiente, validadas uma vez no boot.
 *
 * Falhar aqui é intencional: é muito melhor o container não subir do que
 * descobrir um token faltando quando a primeira mensagem chegar.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name}. Veja app/.env.example.`
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** Config usada apenas no servidor. Nunca importar de um Client Component. */
export const serverEnv = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  meta: {
    /** Versão da Graph API. Subir com cuidado: a Meta muda contratos. */
    apiVersion: optional("META_API_VERSION", "v21.0"),
    accessToken: required("META_ACCESS_TOKEN"),
    phoneNumberId: required("META_PHONE_NUMBER_ID"),
    wabaId: required("META_WABA_ID"),
    /** Usado para validar a assinatura X-Hub-Signature-256 dos webhooks. */
    appSecret: required("META_APP_SECRET"),
    /** Ecoado no handshake GET do webhook. */
    verifyToken: required("META_WEBHOOK_VERIFY_TOKEN"),
  },

  /** Bearer que o n8n usa para chamar /api/internal/*. */
  serviceToken: required("CHAT_SERVICE_TOKEN"),

  /** Webhook do n8n que recebe mensagens quando a conversa está em modo bot. */
  n8nWebhookUrl: optional("N8N_WEBHOOK_URL"),
} as const;

/** Config exposta ao browser. Só o que pode ser público. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
} as const;
