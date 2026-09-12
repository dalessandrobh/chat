import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat — Painel",
  description: "Atendimento e automação de WhatsApp",
};

// `viewportFit: "cover"` é o que libera o `env(safe-area-inset-*)`: sem ele o
// iPhone reserva a faixa do gesto de voltar e a caixa de envio fica flutuando
// acima de uma tarja branca.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
