import { LoginForm } from "@/components/auth/LoginForm";

/**
 * O destino pós-login vem do servidor como prop. Ler searchParams aqui, em
 * vez de useSearchParams() no cliente, deixa o formulário ser renderizado
 * no servidor — senão a página chega em branco e só aparece quando o JS
 * termina de carregar.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm next={next ?? "/inbox"} />;
}
