-- =============================================================================
-- 0023 — Apagar contato da base
-- =============================================================================
-- Até aqui a base era só de mão única: entrava e nunca saía, porque a linha
-- marcada `is_sendable = false` é o que impede recadastrar amanhã quem pediu
-- para sair hoje. Continua sendo — o painel só apaga quando alguém pede, e
-- pede duas vezes quando a linha é um opt-out.
--
-- O que muda é a permissão. `authenticated` ganhou select/insert/update no
-- 0003 e nunca delete; a política `audience_write` já é `for all`, então o
-- grant é a peça que faltava. Só para audience: nas outras tabelas do schema
-- apagar continua fora de alcance.
--
-- Efeito colateral que vale saber: campaign_recipients aponta para audience
-- com `on delete cascade`. Apagar um contato apaga o registro de quais
-- campanhas ele recebeu, e os números daquelas campanhas mudam. É o preço de
-- apagar de verdade em vez de esconder.

grant delete on chat.audience to authenticated;

notify pgrst, 'reload schema';
