import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canManageKnowledge, canManageTemplates, canManageUsers, roleLabel } from "@/lib/roles";
import { SairButton } from "@/components/auth/SairButton";
import { ConversasLink } from "@/components/painel/ConversasLink";
import { MenuPainel, type ItemDeMenu } from "@/components/painel/MenuPainel";
import { PresencaProvider } from "@/components/painel/Presenca";

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

  const itens: ItemDeMenu[] = [
    { href: "/templates", rotulo: "Templates" },
    ...(canManageKnowledge(agent.role)
      ? [
          { href: "/base", rotulo: "Base" },
          { href: "/agente", rotulo: "Agente" },
          { href: "/ajustes", rotulo: "Ajustes" },
        ]
      : []),
    ...(canManageTemplates(agent.role)
      ? [
          { href: "/contatos", rotulo: "Contatos" },
          { href: "/campanhas", rotulo: "Campanhas" },
        ]
      : []),
    { href: "/canais", rotulo: "Canais" },
    // Sem trava de papel: quem atende é quem topa com o número que não devia
    // estar escrevendo.
    { href: "/bloqueios", rotulo: "Bloqueios" },
    ...(canManageUsers(agent.role) ? [{ href: "/usuarios", rotulo: "Usuários" }] : []),
    ...(ehDonoPlataforma ? [{ href: "/plataforma", rotulo: "Plataforma" }] : []),
  ];

  return (
    // A presença fica no layout, e não na tela de conversas: quem está com o
    // painel aberto continua disponível mesmo olhando um template.
    <PresencaProvider
      agenteId={user.id}
      nome={agent.full_name ?? agent.email ?? null}
      empresaId={agent.company_id}
    >
    {/* `h-dvh` e não `h-screen`: no celular o `100vh` conta a barra do
        navegador como se ela não existisse, e a caixa de envio fica embaixo
        dela — a tela em que se digita, fora da tela. */}
    <div className="flex h-dvh flex-col">
      <header
        className="relative flex shrink-0 items-center gap-3 border-b px-3 py-2.5 md:gap-6 md:px-5 md:py-3"
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

        <ConversasLink />

        <MenuPainel
          itens={itens}
          identificacao={`${agent.full_name ?? agent.email} · ${roleLabel(agent.role)}`}
        />

        <span className="ml-auto flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
          {/* No celular quem está logado aparece no pé da gaveta: o cabeçalho
              não tem largura para o nome e o botão de sair ao mesmo tempo. */}
          <span className="hidden md:inline">
            {agent.full_name ?? agent.email} · {roleLabel(agent.role)}
          </span>
          <SairButton />
        </span>
      </header>

      <main className="min-h-0 flex-1">{children}</main>
    </div>
    </PresencaProvider>
  );
}
