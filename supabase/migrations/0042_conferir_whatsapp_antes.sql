-- Conferir se o número tem WhatsApp, antes de disparar.
--
-- Em 10/09/2026 uma campanha saiu por um número novo para 180 contatos. Das
-- 86 mensagens que chegou a mandar, **20 foram para números que não existem no
-- WhatsApp**. Nove minutos depois o WhatsApp encerrou a sessão daquele número
-- com `statusReason: 401` — loggedOut, a desconexão que não é queda de rede.
--
-- Lista com um quinto de números inválidos é o sinal mais alto que existe para
-- um sistema antifraude: quem tem relação com os contatos não erra 20 em 86.
-- Não dá para provar que foi isso que derrubou o número, mas é o que estava
-- acontecendo, e é a única parte que está na nossa mão.
--
-- A Evolution responde isso de graça, e em lote: `/chat/whatsappNumbers`. Esta
-- coluna guarda quando cada número foi conferido pela última vez, para a
-- segunda campanha não reconferir a base inteira.
--
-- Quem não existe no WhatsApp sai da lista pelo caminho que já existia —
-- `chat.opt_out` com motivo `no_whatsapp` —, o mesmo por onde ele sairia
-- depois, ao falhar no disparo. A diferença é que agora sai antes, sem gastar
-- a reputação do número para descobrir.

begin;

alter table chat.audience
  add column if not exists whatsapp_em timestamptz;

comment on column chat.audience.whatsapp_em is
  'Quando se confirmou pela última vez que este número tem WhatsApp. Nulo é "nunca conferido".';

-- A conferência procura por quem nunca foi conferido, e depois pelos mais
-- antigos: é essa a ordem da varredura.
create index if not exists idx_audience_a_conferir
  on chat.audience (company_id, whatsapp_em nulls first) where is_sendable;

commit;

notify pgrst, 'reload schema';
