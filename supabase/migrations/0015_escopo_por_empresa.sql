-- =============================================================================
-- 0015 — Toda linha ganha dono (Fase 2 do multiempresa)
-- =============================================================================
-- Das 14 tabelas, 8 não tinham nenhuma coluna de escopo. As outras 6 se
-- apoiavam em channel_id, que já implica a empresa — mas apoiar a regra de
-- acesso numa junção por linha fica caro justamente na tabela que mais cresce.
-- Por isso a empresa é gravada direto em todas: a política vira uma comparação
-- de igualdade sobre uma coluna indexada.
--
-- Duas tabelas ficam de fora, e é decisão, não esquecimento:
--   webhook_events  — registro de idempotência do provedor, sem dono lógico;
--                     ninguém lê pelo painel e a RLS já nega tudo.
--   companies       — é o dono.

-- -----------------------------------------------------------------------------
-- A âncora
-- -----------------------------------------------------------------------------

alter table chat.channels
  add column if not exists company_id uuid references chat.companies(id) on delete restrict;

update chat.channels
   set company_id = (select id from chat.companies where slug = 'eco-aquecedores')
 where company_id is null;

alter table chat.channels alter column company_id set not null;
create index if not exists idx_channels_company on chat.channels (company_id);

-- -----------------------------------------------------------------------------
-- Descendentes diretos do canal
-- -----------------------------------------------------------------------------

alter table chat.contacts      add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.conversations add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.messages      add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.campaigns     add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.templates     add column if not exists company_id uuid references chat.companies(id) on delete restrict;

update chat.contacts      t set company_id = c.company_id from chat.channels c where c.id = t.channel_id and t.company_id is null;
update chat.conversations t set company_id = c.company_id from chat.channels c where c.id = t.channel_id and t.company_id is null;
update chat.messages      t set company_id = c.company_id from chat.channels c where c.id = t.channel_id and t.company_id is null;
update chat.campaigns     t set company_id = c.company_id from chat.channels c where c.id = t.channel_id and t.company_id is null;
update chat.templates     t set company_id = c.company_id from chat.channels c where c.id = t.channel_id and t.company_id is null;

alter table chat.contacts      alter column company_id set not null;
alter table chat.conversations alter column company_id set not null;
alter table chat.messages      alter column company_id set not null;
alter table chat.campaigns     alter column company_id set not null;
alter table chat.templates     alter column company_id set not null;

create index if not exists idx_contacts_company      on chat.contacts (company_id);
create index if not exists idx_conversations_company on chat.conversations (company_id);
create index if not exists idx_messages_company      on chat.messages (company_id, created_at desc);
create index if not exists idx_campaigns_company     on chat.campaigns (company_id);
create index if not exists idx_templates_company     on chat.templates (company_id);

-- -----------------------------------------------------------------------------
-- Netos
-- -----------------------------------------------------------------------------

alter table chat.campaign_recipients add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.handoff_events      add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.message_batches     add column if not exists company_id uuid references chat.companies(id) on delete restrict;

update chat.campaign_recipients t set company_id = c.company_id from chat.campaigns c     where c.id = t.campaign_id     and t.company_id is null;
update chat.handoff_events      t set company_id = c.company_id from chat.conversations c where c.id = t.conversation_id and t.company_id is null;
update chat.message_batches     t set company_id = c.company_id from chat.conversations c where c.id = t.conversation_id and t.company_id is null;

alter table chat.campaign_recipients alter column company_id set not null;
alter table chat.handoff_events      alter column company_id set not null;
alter table chat.message_batches     alter column company_id set not null;

create index if not exists idx_recipients_company on chat.campaign_recipients (company_id);
create index if not exists idx_handoff_company    on chat.handoff_events (company_id);

-- -----------------------------------------------------------------------------
-- Sem parentesco nenhum: base, ajustes e lista de envio
-- -----------------------------------------------------------------------------

alter table chat.knowledge add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.audience  add column if not exists company_id uuid references chat.companies(id) on delete restrict;
alter table chat.settings  add column if not exists company_id uuid references chat.companies(id) on delete restrict;

update chat.knowledge set company_id = (select id from chat.companies where slug = 'eco-aquecedores') where company_id is null;
update chat.audience  set company_id = (select id from chat.companies where slug = 'eco-aquecedores') where company_id is null;
update chat.settings  set company_id = (select id from chat.companies where slug = 'eco-aquecedores') where company_id is null;

alter table chat.knowledge alter column company_id set not null;
alter table chat.audience  alter column company_id set not null;
alter table chat.settings  alter column company_id set not null;

create index if not exists idx_knowledge_company on chat.knowledge (company_id, position);
create index if not exists idx_audience_company  on chat.audience (company_id);

-- -----------------------------------------------------------------------------
-- As chaves que eram globais e não podiam ser
-- -----------------------------------------------------------------------------
-- O número na lista de envio era único no sistema inteiro. Duas empresas não
-- conseguiriam ter o mesmo contato, e — pior — o descadastro casava só pelo
-- número: quem pedia para sair da empresa A sumia da lista da empresa B.
-- Descadastro é obrigação de quem recebeu o pedido, não das outras.

alter table chat.audience drop constraint if exists audience_wa_id_key;
create unique index if not exists audience_company_wa_id_key on chat.audience (company_id, wa_id);

-- Um ajuste por empresa, não um para todas.
alter table chat.settings drop constraint if exists settings_pkey;
alter table chat.settings add primary key (company_id, key);

-- A seção da base é ordenada dentro da empresa dela.
drop index if exists chat.idx_knowledge_position;
