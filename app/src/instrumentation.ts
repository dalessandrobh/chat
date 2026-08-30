/**
 * Relógio das campanhas.
 *
 * Roda dentro do próprio container do painel. Poderia ser um Schedule do n8n,
 * e a rota /api/internal/campaigns/tick existe justamente para isso — mas uma
 * peça a menos entre o agendamento e o envio é uma peça a menos para quebrar
 * em silêncio.
 *
 * O passo é curto de propósito. Quem decide o ritmo real é o banco: aqui só
 * perguntamos "já pode?" com frequência, e quase sempre a resposta é não.
 */

const PASSO_MS = 15_000;

export async function register() {
  // O instrumentation também é carregado no runtime edge, onde nada disto faz
  // sentido.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { tick } = await import("@/lib/campaigns");

  let rodando = false;

  setInterval(async () => {
    // Um passo por vez: se um envio demorar mais que o intervalo do relógio,
    // dois passos concorrentes furariam a cadência que estamos protegendo.
    if (rodando) return;
    rodando = true;
    try {
      await tick();
    } catch (err) {
      console.error("[campanha] relógio falhou", err);
    } finally {
      rodando = false;
    }
  }, PASSO_MS);

  console.log(`[campanha] relógio ativo, passo de ${PASSO_MS / 1000}s`);
}
