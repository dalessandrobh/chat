import { SairButton } from "@/components/auth/SairButton";

/**
 * Quem entrou, mas não tem cadastro no Chat.
 *
 * Em 28/09/2026 o administrador da Eco Aquecedores foi removido de Usuários
 * sem querer. A conta continuou existindo — remover do Chat não apaga o login
 * —, e ao entrar ele foi parar na tela de criar empresa. A empresa dele já
 * existia, com as conversas todas: o que faltava era acesso.
 *
 * Criar empresa é a tela de quem chegou sozinho, e essa pessoa tem linha em
 * `chat.agents` esperando empresa. Sem linha nenhuma, a conta foi removida ou
 * nunca foi liberada — e aí a saída é uma pessoa, não um formulário.
 */
export function SemAcesso({ email }: { email: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Sua conta ainda não tem acesso</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Você entrou como {email}, mas esta conta não está liberada em nenhuma
          empresa do Chat. Peça a um administrador da sua empresa para liberá-la
          em <strong>Usuários</strong> — o acesso vale na hora, com esta mesma
          senha.
        </p>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          Se a empresa ainda não existe aqui e é você quem vai criá-la, o
          administrador da plataforma abre o cadastro para você.
        </p>

        {/* Sem o cabeçalho do painel, este é o único jeito de trocar de conta —
            e trocar de conta é justamente o que resolve quando alguém entrou
            com o e-mail errado. */}
        <div className="mt-6">
          <SairButton />
        </div>
      </div>
    </main>
  );
}
