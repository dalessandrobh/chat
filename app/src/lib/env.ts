/**
 * Variáveis de ambiente, validadas na primeira vez que são usadas.
 *
 * O projeto fala WhatsApp por dois provedores — Meta Cloud API e Evolution
 * API — e quase nunca pelos dois ao mesmo tempo. Exigir as credenciais dos
 * dois no boot travaria o container por falta de um token que ninguém vai
 * usar. Então cada segredo é um getter: falta só estoura quando alguém
 * realmente tenta usar aquele provedor, e aí a mensagem já diz qual é.
 */

import "server-only";

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

function isSet(name: string): boolean {
  return Boolean(process.env[name]);
}

/** Config usada apenas no servidor. Nunca importar de um Client Component. */
export const serverEnv = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  meta: {
    /** Versão da Graph API. Subir com cuidado: a Meta muda contratos. */
    apiVersion: optional("META_API_VERSION", "v21.0"),
    get accessToken() {
      return required("META_ACCESS_TOKEN");
    },
    get phoneNumberId() {
      return required("META_PHONE_NUMBER_ID");
    },
    get wabaId() {
      return required("META_WABA_ID");
    },
    /** Usado para validar a assinatura X-Hub-Signature-256 dos webhooks. */
    get appSecret() {
      return required("META_APP_SECRET");
    },
    /** Ecoado no handshake GET do webhook. */
    get verifyToken() {
      return required("META_WEBHOOK_VERIFY_TOKEN");
    },
  },

  evolution: {
    /** Ex.: http://evolution-api:8080 (rede interna) ou https://evo.dominio */
    get baseUrl() {
      return required("EVOLUTION_BASE_URL").replace(/\/+$/, "");
    },
    /** AUTHENTICATION_API_KEY da Evolution. Vai no header `apikey`. */
    get apiKey() {
      return required("EVOLUTION_API_KEY");
    },
    /**
     * Endereço e chave padrão da plataforma. São **copiados** para a linha do
     * canal quando ele é criado, e nunca consultados na hora de enviar: quem
     * envia lê a credencial do próprio canal. A diferença importa no dia em
     * que o padrão mudar — o canal antigo continua falando com o servidor
     * onde a sessão dele existe.
     *
     * O token do webhook não mora mais aqui: cada canal tem o seu, gerado no
     * cadastro e guardado no cofre.
     */
    /**
     * Para onde a Evolution manda os eventos de um canal novo. É endereço da
     * rede interna do Docker: o webhook não passa pela internet, então não
     * depende de DNS nem de certificado.
     */
    webhookTarget: optional(
      "EVOLUTION_WEBHOOK_TARGET",
      "http://chat-app:3000/api/webhooks/evolution"
    ),
  },

  /** Quais provedores estão configurados. Usado para telas e diagnóstico. */
  providers: {
    get meta() {
      return isSet("META_ACCESS_TOKEN") && isSet("META_PHONE_NUMBER_ID");
    },
    get evolution() {
      return isSet("EVOLUTION_BASE_URL") && isSet("EVOLUTION_API_KEY");
    },
  },

  /** Bearer que o n8n usa para chamar /api/internal/*. */
  serviceToken: required("CHAT_SERVICE_TOKEN"),

  /** Webhook do n8n que recebe mensagens quando a conversa está em modo bot. */
  n8nWebhookUrl: optional("N8N_WEBHOOK_URL"),

  /**
   * Entender mídia que o cliente manda. Sem chave, nada quebra: a imagem e o
   * áudio seguem indo para uma pessoa, como antes de existir esta seção.
   */
  midia: {
    /** Descrever imagem. É a mesma chave do console.anthropic.com que o n8n usa. */
    anthropicKey: optional("ANTHROPIC_API_KEY"),
    modeloImagem: optional("ANTHROPIC_MODEL_IMAGEM", "claude-opus-5"),
    /** Transcrever áudio. Conta separada — a Anthropic não recebe áudio. */
    openaiKey: optional("OPENAI_API_KEY"),
    modeloAudio: optional("OPENAI_MODEL_AUDIO", "whisper-1"),
    get leImagem() {
      return isSet("ANTHROPIC_API_KEY");
    },
    get leAudio() {
      return isSet("OPENAI_API_KEY");
    },
  },
} as const;

// publicEnv vive em @/lib/env.public — ver o comentário de lá.
