"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type ItemDeMenu = { href: string; rotulo: string };

/**
 * Os links do painel.
 *
 * No PC e no tablet ficam na régua do cabeçalho, como sempre. No celular não
 * cabem — dez links numa linha de 390px empurram nome da empresa e botão de
 * sair para fora da tela — e viram uma gaveta atrás do ☰.
 *
 * O contador da fila não entra aqui: ele fica no cabeçalho em qualquer
 * tamanho, porque saber que chegou gente esperando não pode depender de abrir
 * um menu.
 */
export function MenuPainel({
  itens,
  identificacao,
}: {
  itens: ItemDeMenu[];
  /** Quem está logado. No celular o cabeçalho não tem largura para isso. */
  identificacao: string;
}) {
  const [aberta, setAberta] = useState(false);
  const rota = usePathname();

  // Navegar fecha a gaveta. O clique no link já faz isso, mas o botão de
  // voltar do navegador não passa por clique nenhum.
  useEffect(() => setAberta(false), [rota]);

  return (
    <>
      <nav className="hidden gap-4 text-sm md:flex">
        {itens.map((item) => (
          <Link key={item.href} href={item.href} className="hover:underline">
            {item.rotulo}
          </Link>
        ))}
      </nav>

      {/* `order-first` põe o ☰ na ponta esquerda no celular sem mexer na ordem
          em que os links aparecem no PC. */}
      <button
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        aria-label={aberta ? "Fechar menu" : "Abrir menu"}
        className="order-first rounded-lg border px-2 py-1.5 text-sm leading-none md:hidden"
        style={{ borderColor: "var(--border)" }}
      >
        ☰
      </button>

      {aberta && (
        <div
          className="absolute left-0 right-0 top-full z-40 border-b shadow-lg md:hidden"
          style={{ borderColor: "var(--border)", background: "var(--panel)" }}
        >
          <nav className="grid grid-cols-2 gap-1 p-3 text-sm">
            {itens.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setAberta(false)}
                className="rounded-lg px-3 py-2.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                {item.rotulo}
              </Link>
            ))}
          </nav>
          <p
            className="border-t px-3 py-2 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            {identificacao}
          </p>
        </div>
      )}
    </>
  );
}
