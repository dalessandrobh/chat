import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageKnowledge, canManageTemplates, canManageUsers, roleLabel } from "@/lib/roles";

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
    .select("full_name, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  // Conta criada mas ainda não liberada por um admin.
  if (!agent?.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Acesso pendente</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Sua conta ({user.email}) ainda não foi ativada. Peça a um
            administrador para liberar em <code>chat.agents</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header
        className="flex shrink-0 items-center gap-6 border-b px-5 py-3"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <span className="text-sm font-semibold">Chat</span>

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

        <span className="ml-auto text-xs" style={{ color: "var(--muted)" }}>
          {agent.full_name ?? agent.email} · {roleLabel(agent.role)}
        </span>
      </header>

      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
