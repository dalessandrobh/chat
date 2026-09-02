import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageKnowledge, canManageTemplates, canManageUsers, roleLabel } from "@/lib/roles";
import { SairButton } from "@/components/auth/SairButton";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: agent } = await supabase
    .from("agents")
    .select("full_name, email, role, is_active, company_id")
    .eq("id", user.id)
    .maybeSingle();

  // Chegou sozinho e ainda não tem empresa: cria a dele em vez de esperar que
  // alguém libere no banco. Quem foi convidado já nasce com empresa e cai no
  // caso de baixo.
  if (!agent?.company_id) redirect("/comecar");

  // Convidado, com empresa, mas ainda não liberado.
  if (!agent.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Acesso pendente</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Sua conta ({user.email}) ainda não foi liberada. Peça a um
            administrador da sua empresa para ativá-la em Usuários.
          </p>
        </div>
      </main>
    );
  }

  const { data: ehDonoPlataforma } = await supabase.rpc("is_platform_owner");

  // Qual empresa está aberta. Com uma por pessoa isso raramente muda, mas
  // quem opera a plataforma entra na conta de clientes para dar suporte — e
  // não saber de quem é o inbox é como se responde pela empresa errada.
  const { data: empresa } = await supabase.from("companies").select("name").maybeSingle();

  return (
    <div className="flex h-screen flex-col">
      <header
        className="flex shrink-0 items-center gap-6 border-b px-5 py-3"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <Link href="/empresa" className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold">Chat</span>
          {empresa?.name && (
            <span
              className="truncate text-sm"
              style={{ color: "var(--muted)" }}
              title={empresa.name}
            >
              {empresa.name}
            </span>
          )}
        </Link>

        <nav className="flex gap-4 text-sm">
          <Link href="/inbox" className="hover:underline">
            Conversas
          </Link>
          <Link href="/templates" className="hover:underline">
            Templates
          </Link>
          {canManageKnowledge(agent.role) && (
            <>
              <Link href="/base" className="hover:underline">
                Base
              </Link>
              <Link href="/ajustes" className="hover:underline">
                Ajustes
              </Link>
            </>
          )}
          {canManageTemplates(agent.role) && (
            <>
              <Link href="/contatos" className="hover:underline">
                Contatos
              </Link>
              <Link href="/campanhas" className="hover:underline">
                Campanhas
              </Link>
            </>
          )}
          <Link href="/canais" className="hover:underline">
            Canais
          </Link>
          {canManageUsers(agent.role) && (
            <Link href="/usuarios" className="hover:underline">
              Usuários
            </Link>
          )}
        </nav>

        <span className="ml-auto flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
          {ehDonoPlataforma && (
            <Link href="/plataforma" className="hover:underline">
              Plataforma
            </Link>
          )}
          <span>
            {agent.full_name ?? agent.email} · {roleLabel(agent.role)}
          </span>
          <SairButton />
        </span>
      </header>

      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
