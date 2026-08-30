/**
 * Papéis do painel.
 *
 * Sem dependência de ambiente de propósito: este arquivo é importado tanto por
 * Server Components quanto por Client Components.
 */

export type AgentRole = "admin" | "manager" | "agent";

export const ROLES: AgentRole[] = ["admin", "manager", "agent"];

export const ROLE_LABEL: Record<AgentRole, string> = {
  admin: "Administrador",
  manager: "Gestor",
  agent: "Usuário",
};

export const ROLE_DESCRIPTION: Record<AgentRole, string> = {
  admin: "Gerencia usuários e canais, além de tudo que o gestor faz.",
  manager: "Cuida do atendimento e dos templates. Não mexe em usuários.",
  agent: "Atende conversas: responde, assume e devolve ao bot.",
};

export function isRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

export function roleLabel(role: string | null | undefined): string {
  return isRole(role) ? ROLE_LABEL[role] : "—";
}

// -----------------------------------------------------------------------------
// Permissões
// -----------------------------------------------------------------------------
// Quem entra e quem opera são decisões diferentes: o gestor toca o atendimento
// sem poder criar acesso para ninguém.

export const canManageUsers = (role?: string | null) => role === "admin";
export const canManageChannels = (role?: string | null) => role === "admin";
export const canManageTemplates = (role?: string | null) =>
  role === "admin" || role === "manager";
