-- =============================================================================
-- 0017 — As funções que ignoram a RLS (Fase 3, parte do banco)
-- =============================================================================
-- 14 funções são SECURITY DEFINER: rodam com os direitos de quem as criou e
-- passam por cima de qualquer política. Não é descuido — é como elas conseguem
-- gravar em nome do webhook, que não tem usuário logado. Mas significa que a
-- separação por empresa aqui é responsabilidade do corpo da função, não do
-- banco.
--
-- Duas regras, aplicadas em todas:
--   1. quem grava, carimba a empresa — derivada do canal ou da conversa,
--      nunca de um parâmetro que veio de fora;
--   2. quem age em nome de uma pessoa logada confere se o alvo é da empresa
--      dela antes de tocar em qualquer coisa.
--
-- Chamada sem usuário logado (auth.uid() nulo) é o servidor agindo por conta
-- própria, e aí a empresa vem do dado. Chamada com usuário é o painel, e aí
-- tem de bater.

-- -----------------------------------------------------------------------------
-- Guarda comum
-- -----------------------------------------------------------------------------

create or replace function chat.assert_same_company(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = chat, public
as $$
begin
  -- Sem usuário logado é o próprio servidor: a empresa já veio do dado.
  if auth.uid() is null then
    return;
  end if;

  if p_company_id is distinct from chat.current_company() then
    raise exception 'Esta operação é de outra empresa'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contato e conversa nascem com dono
-- -----------------------------------------------------------------------------

create or replace function chat.resolve_conversation(
  p_channel_id uuid,
  p_wa_id text,
  p_profile_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company_id      uuid;
  v_contact_id      uuid;
  v_conversation_id uuid;
begin
  -- A empresa vem do canal, sempre. É o único caminho: o canal é identificado
  -- pela instância que mandou o evento, e ninguém de fora escolhe isso.
  select company_id into v_company_id from chat.channels where id = p_channel_id;
  if v_company_id is null then
    raise exception 'Canal % não encontrado', p_channel_id;
  end if;

  perform chat.assert_same_company(v_company_id);

  insert into chat.contacts (channel_id, wa_id, profile_name, company_id)
  values (p_channel_id, p_wa_id, p_profile_name, v_company_id)
  on conflict (channel_id, wa_id) do update
    set profile_name = coalesce(excluded.profile_name, chat.contacts.profile_name)
  returning id into v_contact_id;

  insert into chat.conversations (channel_id, contact_id, company_id)
  values (p_channel_id, v_contact_id, v_company_id)
  on conflict (contact_id) do update
    set updated_at = now()
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Descadastro, agora da empresa certa
-- -----------------------------------------------------------------------------
-- Antes casava só pelo número: quem pedia para sair da empresa A sumia da
-- lista da B. Descadastro é obrigação de quem recebeu o pedido, e de mais
-- ninguém.

drop function if exists chat.opt_out(text, chat.unsendable_reason);

create or replace function chat.opt_out(
  p_company_id uuid,
  p_wa_id text,
  p_reason chat.unsendable_reason default 'opt_out'
)
returns boolean
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_mudou boolean := false;
begin
  perform chat.assert_same_company(p_company_id);

  update chat.audience
     set is_sendable = false,
         unsendable_reason = p_reason,
         unsendable_at = now()
   where company_id = p_company_id and wa_id = p_wa_id and is_sendable
  returning true into v_mudou;

  -- Quem já estava na fila de uma campanha sai dela também. Sem isto, alguém
  -- que pede para sair às 10h ainda recebe o disparo das 11h.
  update chat.campaign_recipients r
     set status = 'skipped'
   where r.company_id = p_company_id
     and r.wa_id = p_wa_id
     and r.status = 'pending';

  return coalesce(v_mudou, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Assumir, devolver, marcar como lida
-- -----------------------------------------------------------------------------

create or replace function chat.take_over(
  p_conversation_id uuid,
  p_reason text default null,
  p_resume_after interval default null
)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent   uuid := auth.uid();
  v_before  chat.conversation_mode;
  v_company uuid;
  v_row     chat.conversations;
begin
  if v_agent is null then
    raise exception 'take_over exige um usuário autenticado';
  end if;

  select mode, company_id into v_before, v_company
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  update chat.conversations
     set mode              = 'human',
         assigned_agent_id = v_agent,
         status            = case when status = 'closed' then 'open'::chat.conversation_status
                                  else status end,
         bot_resume_at     = case when p_resume_after is null then null
                                  else now() + p_resume_after end
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason, company_id)
  values (p_conversation_id, v_before, 'human', 'agent', v_agent, p_reason, v_company);

  return v_row;
end;
$$;

create or replace function chat.hand_back(p_conversation_id uuid, p_reason text default null)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent   uuid := auth.uid();
  v_before  chat.conversation_mode;
  v_company uuid;
  v_row     chat.conversations;
begin
  select mode, company_id into v_before, v_company
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  update chat.conversations
     set mode              = 'bot',
         assigned_agent_id = null,
         bot_resume_at     = null
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason, company_id)
  values (p_conversation_id, v_before, 'bot', 'agent', v_agent, p_reason, v_company);

  return v_row;
end;
$$;

create or replace function chat.take_over_external(p_conversation_id uuid, p_reason text default null)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_before  chat.conversation_mode;
  v_company uuid;
  v_row     chat.conversations;
begin
  select mode, company_id into v_before, v_company
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Já estava em atendimento humano: nada a fazer, e sobretudo não sobrescrever
  -- o agente que assumiu pelo painel.
  if v_before = 'human' then
    select * into v_row from chat.conversations where id = p_conversation_id;
    return v_row;
  end if;

  update chat.conversations
     set mode          = 'human',
         status        = case when status = 'closed' then 'open'::chat.conversation_status
                              else status end,
         bot_resume_at = null
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason, company_id)
  values (p_conversation_id, v_before, 'human', 'system', p_reason, v_company);

  return v_row;
end;
$$;

create or replace function chat.mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from chat.conversations where id = p_conversation_id;
  if not found then
    return;
  end if;

  perform chat.assert_same_company(v_company);

  update chat.conversations set unread_count = 0 where id = p_conversation_id;
end;
$$;

create or replace function chat.auto_hand_back_expired()
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_count   integer := 0;
  v_id      uuid;
  v_company uuid;
begin
  for v_id, v_company in
    select id, company_id from chat.conversations
     where mode = 'human'
       and bot_resume_at is not null
       and bot_resume_at <= now()
     for update skip locked
  loop
    update chat.conversations
       set mode = 'bot', assigned_agent_id = null, bot_resume_at = null
     where id = v_id;

    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason, company_id)
    values (v_id, 'human', 'bot', 'system', 'Devolução automática por tempo', v_company);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Campanha: fila só com gente da própria lista
-- -----------------------------------------------------------------------------

create or replace function chat.enqueue_campaign(p_campaign_id uuid, p_tags text[] default null)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_total   integer;
  v_company uuid;
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores montam campanhas'
      using errcode = 'insufficient_privilege';
  end if;

  select company_id into v_company from chat.campaigns where id = p_campaign_id;
  if v_company is null then
    raise exception 'Campanha % não encontrada', p_campaign_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Só quem pode receber, e só da lista desta empresa.
  insert into chat.campaign_recipients (campaign_id, audience_id, name, wa_id, company_id)
  select p_campaign_id, a.id, a.name, a.wa_id, v_company
    from chat.audience a
   where a.company_id = v_company
     and a.is_sendable
     and (p_tags is null or a.tags && p_tags)
  on conflict (campaign_id, audience_id) do nothing;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Turno do bot
-- -----------------------------------------------------------------------------

create or replace function chat.enqueue_bot_turn(
  p_conversation_id uuid,
  p_payload jsonb,
  p_janela interval default '8 seconds',
  p_teto interval default '40 seconds'
)
returns timestamptz
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_due     timestamptz;
  v_company uuid;
begin
  select company_id into v_company from chat.conversations where id = p_conversation_id;
  if v_company is null then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  insert into chat.message_batches (conversation_id, due_at, first_at, payload, company_id)
  values (p_conversation_id, now() + p_janela, now(), p_payload, v_company)
  on conflict (conversation_id) do update
    set due_at    = least(now() + p_janela, message_batches.first_at + p_teto),
        payload   = jsonb_set(
                      excluded.payload,
                      '{text}',
                      to_jsonb(
                        btrim(
                          coalesce(message_batches.payload ->> 'text', '') || E'\n' ||
                          coalesce(excluded.payload ->> 'text', '')
                        )
                      )
                    ),
        mensagens = message_batches.mensagens + 1
  returning due_at into v_due;

  return v_due;
end;
$$;

-- -----------------------------------------------------------------------------
-- Base de conhecimento
-- -----------------------------------------------------------------------------
-- O `delete ... where true` da importação apagava a base inteira do sistema.
-- Com duas empresas, importar a base de uma apagaria a da outra — sem erro na
-- tela, sem aviso, sem volta.

create or replace function chat.replace_knowledge(p_sections jsonb)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_total   integer;
  v_company uuid := chat.current_company();
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores podem importar a base'
      using errcode = 'insufficient_privilege';
  end if;

  if v_company is null then
    raise exception 'Sem empresa: não há base para substituir'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'Nada para importar';
  end if;

  delete from chat.knowledge where company_id = v_company;

  insert into chat.knowledge (title, content, position, is_active, updated_by, company_id)
  select
    s ->> 'title',
    s ->> 'content',
    coalesce((s ->> 'position')::integer, 0),
    coalesce((s ->> 'is_active')::boolean, false),
    nullif(s ->> 'updated_by', '')::uuid,
    v_company
  from jsonb_array_elements(p_sections) as s;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- O prompt do agente é montado com a base de UMA empresa. Sem o parâmetro, o
-- servidor (que ignora RLS) misturaria a base de todas num prompt só.
drop function if exists chat.render_knowledge();

create or replace function chat.render_knowledge(p_company_id uuid)
returns text
language sql
stable
security definer
set search_path = chat, public
as $$
  select coalesce(
    string_agg('## ' || title || E'\n' || content, E'\n\n' order by position, created_at),
    ''
  )
  from chat.knowledge
  where is_active and company_id = p_company_id;
$$;

-- -----------------------------------------------------------------------------
-- Sempre sobra um administrador — por empresa
-- -----------------------------------------------------------------------------

create or replace function chat.guard_last_admin()
returns trigger
language plpgsql
as $$
declare
  v_restantes integer;
begin
  if tg_op = 'UPDATE'
     and old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
  then
    null;
  elsif tg_op = 'DELETE' and old.role = 'admin' and old.is_active then
    null;
  else
    return coalesce(new, old);
  end if;

  -- Contar admins do sistema inteiro diria "ainda sobra um" quando o que
  -- sobrou é administrador de outra empresa.
  select count(*) into v_restantes
    from chat.agents
   where role = 'admin' and is_active
     and id <> old.id
     and company_id is not distinct from old.company_id;

  if v_restantes = 0 then
    raise exception 'Este é o último administrador ativo desta empresa: promova outra pessoa antes.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------

grant execute on function chat.assert_same_company(uuid) to authenticated, service_role;
grant execute on function chat.opt_out(uuid, text, chat.unsendable_reason) to service_role;
grant execute on function chat.render_knowledge(uuid) to authenticated, service_role;
