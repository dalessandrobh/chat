/**
 * Os relógios do painel.
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

/**
 * O passo dos turnos do bot é curto porque o cliente está esperando: a janela
 * já custa alguns segundos, e o relógio não pode custar outros tantos por
 * cima. Quase toda batida não acha nada e volta.
 */
const PASSO_LOTE_MS = 2_000;

export async function register() {
  // O instrumentation também é carregado no runtime edge, onde nada disto faz
  // sentido.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { tick } = await import("@/lib/campaigns");
  const { despacharTurnosVencidos } = await import("@/lib/bot-queue");

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

  let despachando = false;

  setInterval(async () => {
    if (despachando) return;
    despachando = true;
    try {
      await despacharTurnosVencidos();
    } catch (err) {
      console.error("[lote] relógio falhou", err);
    } finally {
      despachando = false;
    }
  }, PASSO_LOTE_MS);

  console.log(`[lote] relógio dos turnos ativo, passo de ${PASSO_LOTE_MS / 1000}s`);
}
