import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

/**
 * useSearchParams() força renderização no cliente, então o formulário fica
 * num componente próprio dentro de um Suspense — sem isso o Next não
 * consegue pré-renderizar esta rota no build.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
