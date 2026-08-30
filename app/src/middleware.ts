/**
 * Renova a sessão do Supabase a cada request e protege as rotas do painel.
 *
 * Server Components não conseguem escrever cookies, então a renovação do
 * token precisa acontecer aqui — senão a sessão expira e o agente é
 * deslogado no meio do atendimento.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // getUser() revalida o token no servidor. Não trocar por getSession(),
  // que confia no cookie sem verificar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Só as páginas do painel. Todo /api/* fica de fora de propósito:
     *   - o webhook da Meta autentica por assinatura HMAC, não por sessão;
     *   - /api/internal/* usa service token do n8n;
     *   - /api/health precisa responder sem login, senão o healthcheck do
     *     container falha para sempre;
     *   - as demais rotas fazem sua própria checagem e devolvem 401 em
     *     JSON, o que um redirect 302 para /login quebraria.
     *
     * Arquivo em /public também fica de fora: o middleware o mandaria para
     * /login, e um .json ou .png redirecionado não é um arquivo — é uma
     * página HTML com o content-type errado. Daí a exclusão de qualquer
     * caminho com extensão.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.).*)",
  ],
};
