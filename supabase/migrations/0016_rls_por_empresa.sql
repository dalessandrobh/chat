-- =============================================================================
-- 0016 — Regras de acesso por empresa (Fase 2, parte 2)
-- =============================================================================
-- Toda política ganha a mesma comparação: a linha é da empresa de quem pediu.
-- Como chat.current_company() devolve NULO para quem não é agente ativo, e
-- comparação com NULO é falsa, a política nega sozinha — não precisa de um
-- "e existe agente" em cada uma.
--
-- Nenhuma política tem exceção para dono de plataforma. Toda porta de fuga
-- dentro da regra de acesso é um vazamento esperando: basta uma condição
-- avaliar errado uma vez e ninguém percebe. Suporte enxergar a conta do
-- cliente é superfície separada e auditada, não um "ou" no meio da política.

-- -----------------------------------------------------------------------------
-- ANTES DE TUDO: as views ignoravam a RLS
-- -----------------------------------------------------------------------------
-- View sem security_invoker roda com os direitos de quem a criou, não de quem
-- consulta — e o dono é o superusuário, que passa por cima de qualquer
-- política. Medido antes desta migração: um usuário logado que não era agente
-- de ninguém via 0 linhas em chat.conversations e 7 em chat.inbox, com nome,
-- telefone e prévia da conversa.
--
-- Isso já valia com uma empresa só. Com duas, seria uma lendo a outra pela
-- tela principal.

alter view chat.inbox          set (security_invoker = true);
alter view chat.campaign_stats set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- Pessoas
-- -----------------------------------------------------------------------------

drop policy if exists agents_select on chat.agents;
create policy agents_select on chat.agents
  for select to authenticated
  using (
    -- A própria linha sempre: é o que a tela usa para saber quem você é, e
    -- quem ainda não tem empresa precisa ver a mensagem de acesso pendente.
    id = auth.uid()
    or (chat.is_active_agent() and company_id = chat.current_company())
  );

drop policy if exists agents_admin_all on chat.agents;
create policy agents_admin_all on chat.agents
  for all to authenticated
  using (chat.is_admin() and company_id = chat.current_company())
  with check (chat.is_admin() and company_id = chat.current_company());

-- agents_update_self continua como está: é sobre você, não sobre a empresa.

-- -----------------------------------------------------------------------------
-- Atendimento
-- -----------------------------------------------------------------------------

drop policy if exists contacts_agent_all on chat.contacts;
create policy contacts_agent_all on chat.contacts
  for all to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company())
  with check (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists conversations_agent_all on chat.conversations;
create policy conversations_agent_all on chat.conversations
  for all to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company())
  with check (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists messages_agent_select on chat.messages;
create policy messages_agent_select on chat.messages
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists handoff_select on chat.handoff_events;
create policy handoff_select on chat.handoff_events
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

-- -----------------------------------------------------------------------------
-- Canais
-- -----------------------------------------------------------------------------

drop policy if exists channels_select on chat.channels;
create policy channels_select on chat.channels
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists channels_admin_write on chat.channels;
create policy channels_admin_write on chat.channels
  for all to authenticated
  using (chat.is_admin() and company_id = chat.current_company())
  with check (chat.is_admin() and company_id = chat.current_company());

-- -----------------------------------------------------------------------------
-- Conteúdo e configuração
-- -----------------------------------------------------------------------------

drop policy if exists knowledge_select on chat.knowledge;
create policy knowledge_select on chat.knowledge
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists knowledge_write on chat.knowledge;
create policy knowledge_write on chat.knowledge
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

drop policy if exists settings_select on chat.settings;
create policy settings_select on chat.settings
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists settings_write on chat.settings;
create policy settings_write on chat.settings
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

drop policy if exists templates_select on chat.templates;
create policy templates_select on chat.templates
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists templates_write on chat.templates;
create policy templates_write on chat.templates
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

-- -----------------------------------------------------------------------------
-- Campanhas
-- -----------------------------------------------------------------------------

drop policy if exists audience_select on chat.audience;
create policy audience_select on chat.audience
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists audience_write on chat.audience;
create policy audience_write on chat.audience
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

drop policy if exists campaigns_select on chat.campaigns;
create policy campaigns_select on chat.campaigns
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists campaigns_write on chat.campaigns;
create policy campaigns_write on chat.campaigns
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

drop policy if exists recipients_select on chat.campaign_recipients;
create policy recipients_select on chat.campaign_recipients
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists recipients_write on chat.campaign_recipients;
create policy recipients_write on chat.campaign_recipients
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

-- -----------------------------------------------------------------------------
-- Quem se cadastra agora
-- -----------------------------------------------------------------------------
-- Ponte até o fluxo de convite: enquanto existir uma empresa só, o cadastro
-- entra nela e a tela de Usuários continua funcionando como sempre. No dia em
-- que existir a segunda, o gatilho para de adivinhar e a pessoa nasce sem
-- empresa — sem enxergar nada, que é o certo para um desconhecido.

create or replace function chat.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
begin
  select id into v_company
    from chat.companies
   where is_active
   limit 2;

  if (select count(*) from chat.companies where is_active) <> 1 then
    v_company := null;
  end if;

  insert into chat.agents (id, email, full_name, avatar_url, company_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    v_company
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
