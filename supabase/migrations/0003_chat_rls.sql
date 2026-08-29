-- =============================================================================
-- Projeto Chat — permissões, RLS e Realtime
-- =============================================================================
-- Modelo de acesso: time único. Todo agente ativo enxerga todas as conversas.
-- Quando houver multi-tenant, trocar as policies por filtro em channel_id.

-- -----------------------------------------------------------------------------
-- GRANTS — expõe o schema para PostgREST
-- -----------------------------------------------------------------------------

grant usage on schema chat to anon, authenticated, service_role;

grant all on all tables    in schema chat to service_role;
grant all on all sequences in schema chat to service_role;
grant all on all functions in schema chat to service_role;

grant select, insert, update on all tables in schema chat to authenticated;
grant execute on all functions in schema chat to authenticated;

-- Objetos futuros herdam os mesmos grants
alter default privileges in schema chat
  grant all on tables to service_role;
alter default privileges in schema chat
  grant select, insert, update on tables to authenticated;
alter default privileges in schema chat
  grant execute on functions to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Helper: o usuário logado é um agente ativo?
-- -----------------------------------------------------------------------------

create or replace function chat.is_active_agent()
returns boolean
language sql
stable
security definer
set search_path = chat, public
as $$
  select exists (
    select 1 from chat.agents
     where id = auth.uid() and is_active
  );
$$;

create or replace function chat.is_admin()
returns boolean
language sql
stable
security definer
set search_path = chat, public
as $$
  select exists (
    select 1 from chat.agents
     where id = auth.uid() and is_active and role in ('owner', 'admin')
  );
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table chat.agents         enable row level security;
alter table chat.channels       enable row level security;
alter table chat.contacts       enable row level security;
alter table chat.conversations  enable row level security;
alter table chat.messages       enable row level security;
alter table chat.templates      enable row level security;
alter table chat.handoff_events enable row level security;
alter table chat.webhook_events enable row level security;

-- AGENTS: cada um lê o time inteiro, mas só edita o próprio perfil.
drop policy if exists agents_select on chat.agents;
create policy agents_select on chat.agents
  for select to authenticated using (chat.is_active_agent());

drop policy if exists agents_update_self on chat.agents;
create policy agents_update_self on chat.agents
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists agents_admin_all on chat.agents;
create policy agents_admin_all on chat.agents
  for all to authenticated using (chat.is_admin()) with check (chat.is_admin());

-- CHANNELS: leitura para agentes, escrita só admin.
drop policy if exists channels_select on chat.channels;
create policy channels_select on chat.channels
  for select to authenticated using (chat.is_active_agent());

drop policy if exists channels_admin_write on chat.channels;
create policy channels_admin_write on chat.channels
  for all to authenticated using (chat.is_admin()) with check (chat.is_admin());

-- CONTACTS / CONVERSATIONS: agentes ativos leem e editam.
drop policy if exists contacts_agent_all on chat.contacts;
create policy contacts_agent_all on chat.contacts
  for all to authenticated using (chat.is_active_agent()) with check (chat.is_active_agent());

drop policy if exists conversations_agent_all on chat.conversations;
create policy conversations_agent_all on chat.conversations
  for all to authenticated using (chat.is_active_agent()) with check (chat.is_active_agent());

-- MESSAGES: agentes leem tudo. Inserção direta pelo cliente é bloqueada de
-- propósito — mensagem sainte passa pela API do app, que fala com a Meta e
-- só então grava. Isso evita mensagem "fantasma" no painel.
drop policy if exists messages_agent_select on chat.messages;
create policy messages_agent_select on chat.messages
  for select to authenticated using (chat.is_active_agent());

-- TEMPLATES: agentes leem, admin escreve.
drop policy if exists templates_select on chat.templates;
create policy templates_select on chat.templates
  for select to authenticated using (chat.is_active_agent());

drop policy if exists templates_admin_write on chat.templates;
create policy templates_admin_write on chat.templates
  for all to authenticated using (chat.is_admin()) with check (chat.is_admin());

-- HANDOFF EVENTS: só leitura no painel; escrita vem das funções security definer.
drop policy if exists handoff_select on chat.handoff_events;
create policy handoff_select on chat.handoff_events
  for select to authenticated using (chat.is_active_agent());

-- WEBHOOK EVENTS: nenhuma policy para authenticated. Só service_role, que
-- ignora RLS. Payload cru não precisa chegar ao browser.

-- -----------------------------------------------------------------------------
-- REALTIME — o painel escuta mudanças em conversas e mensagens
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'chat' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table chat.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'chat' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table chat.conversations;
  end if;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime não existe; pulando';
end $$;

-- REPLICA IDENTITY FULL: sem isso o Realtime não entrega o registro anterior
-- em UPDATE, e o painel não consegue aplicar a policy no evento.
alter table chat.messages      replica identity full;
alter table chat.conversations replica identity full;
