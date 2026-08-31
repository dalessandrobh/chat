/**
 * As credenciais de um canal.
 *
 * Antes viviam em variável de ambiente do servidor — uma empresa, cravada no
 * processo. Agora ficam na linha do canal, com o valor no cofre do Postgres e
 * só o identificador na coluna. Quem lê é o servidor, pela função
 * `chat.channel_credentials`, que não é concedida ao navegador: o painel sabe
 * quais credenciais estão preenchidas, nunca o que elas são.
 *
 * Não existe queda para o ambiente. Canal sem credencial falha com erro claro
 * — a alternativa seria mandar mensagem da empresa B pelo número da empresa A
 * e ninguém perceber.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ConexaoEvolution {
  baseUrl: string;
  apiKey: string;
}

export interface CredenciaisCanal {
  channelId: string;
  companyId: string;
  provider: "evolution" | "meta_cloud";
  instanceName: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  baseUrl: string | null;
  isActive: boolean;
  api_key?: string;
  webhook_token?: string;
  access_token?: string;
  app_secret?: string;
  verify_token?: string;
}

export class CredencialFaltando extends Error {
  constructor(channelId: string, o_que: string) {
    super(`Canal ${channelId} está sem ${o_que}. Preencha em Canais → Credenciais.`);
    this.name = "CredencialFaltando";
  }
}

/**
 * Uma consulta por canal por requisição. O ciclo de vida é o do processo que
 * atende a chamada — não é cache de longa duração de propósito: trocar uma
 * credencial no painel não pode depender de reiniciar o contêiner.
 */
const cache = new Map<string, { em: number; valor: CredenciaisCanal }>();
const VALIDADE_MS = 10_000;

export async function credenciaisDoCanal(channelId: string): Promise<CredenciaisCanal> {
  const guardado = cache.get(channelId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.valor;

  const { data, error } = await supabaseAdmin().rpc("channel_credentials", {
    p_channel_id: channelId,
  });

  if (error) throw new Error(`Não consegui ler as credenciais do canal: ${error.message}`);

  const valor = data as CredenciaisCanal;
  cache.set(channelId, { em: Date.now(), valor });
  return valor;
}

/** Esquece o que estava guardado. Chamado depois de gravar uma credencial. */
export function esquecerCredenciais(channelId: string) {
  cache.delete(channelId);
}

/** O par endereço+chave que o cliente da Evolution precisa, ou erro dizendo o que falta. */
export function conexaoEvolution(cred: CredenciaisCanal): ConexaoEvolution {
  if (!cred.baseUrl) throw new CredencialFaltando(cred.channelId, "o endereço do servidor");
  if (!cred.api_key) throw new CredencialFaltando(cred.channelId, "a chave da API");
  return { baseUrl: cred.baseUrl.replace(/\/+$/, ""), apiKey: cred.api_key };
}

export async function conexaoDoCanal(channelId: string): Promise<ConexaoEvolution> {
  return conexaoEvolution(await credenciaisDoCanal(channelId));
}
