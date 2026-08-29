-- =============================================================================
-- Projeto Chat — lógica de conversa, janela de 24h e handoff bot ↔ humano
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Manutenção automática do estado da conversa a cada mensagem
-- -----------------------------------------------------------------------------

create or replace function chat.sync_conversation_on_message()
returns trigger
language plpgsql
as $$
declare
  v_preview text;
begin
  -- Preview curto para a lista do inbox
  v_preview := left(
    coalesce(
      nullif(new.body, ''),
      case new.type
        when 'image'    then '📷 Imagem'
        when 'audio'    then '🎤 Áudio'
        when 'video'    then '🎬 Vídeo'
        when 'document' then '📎 Documento'
        when 'sticker'  then '🙂 Figurinha'
        when 'location' then '📍 Localização'
        when 'contacts' then '👤 Contato'
        when 'template' then '📋 Template'
        else new.type
      end
    ), 200);

  if new.direction = 'in' then
    update chat.conversations c
       set last_inbound_at    = new.created_at,
           last_message_at    = new.created_at,
           -- A janela de atendimento da Meta reabre a cada mensagem do contato
           window_expires_at  = new.created_at + interval '24 hours',
           unread_count       = c.unread_count + 1,
           last_message_preview = v_preview,
           -- Uma conversa fechada reabre sozinha quando o contato volta a falar
           status = case when c.status = 'closed' then 'open'::chat.conversation_status
                         else c.status end
     where c.id = new.conversation_id;

  else
    update chat.conversations c
       set last_outbound_at = new.created_at,
           last_message_at  = new.created_at,
           last_message_preview = v_preview
     where c.id = new.conversation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_message_syncs_conversation on chat.messages;
create trigger trg_message_syncs_conversation
  after insert on chat.messages
  for each row execute function chat.sync_conversation_on_message();

-- -----------------------------------------------------------------------------
-- A conversa está dentro da janela de 24h?
-- Fora dela, a Meta só aceita template aprovado — o painel usa isso para
-- desabilitar a caixa de texto livre.
-- -----------------------------------------------------------------------------

create or replace function chat.is_within_window(p_conversation_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(window_expires_at > now(), false)
    from chat.conversations
   where id = p_conversation_id;
$$;

-- -----------------------------------------------------------------------------
-- HANDOFF: assumir a conversa (bot → humano)
-- -----------------------------------------------------------------------------

create or replace function chat.take_over(
  p_conversation_id uuid,
  p_reason          text default null,
  p_resume_after    interval default null   -- ex: '2 hours' devolve sozinho
)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent  uuid := auth.uid();
  v_before chat.conversation_mode;
  v_row    chat.conversations;
begin
  if v_agent is null then
    raise exception 'take_over exige um usuário autenticado';
  end if;

  select mode into v_before from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  update chat.conversations
     set mode              = 'human',
         assigned_agent_id = v_agent,
         status            = case when status = 'closed' then 'open'::chat.conversation_status
                                  else status end,
         bot_resume_at     = case when p_resume_after is null then null
                                  else now() + p_resume_after end
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason)
  values (p_conversation_id, v_before, 'human', 'agent', v_agent, p_reason);

  return v_row;
end;
$$;

comment on function chat.take_over is
  'Agente assume a conversa. O bot para de responder até hand_back(). Opcionalmente devolve sozinho após p_resume_after.';

-- -----------------------------------------------------------------------------
-- HANDOFF: devolver a conversa ao bot (humano → bot)
-- -----------------------------------------------------------------------------

create or replace function chat.hand_back(
  p_conversation_id uuid,
  p_reason          text default null
)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent  uuid := auth.uid();
  v_before chat.conversation_mode;
  v_row    chat.conversations;
begin
  select mode into v_before from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  update chat.conversations
     set mode              = 'bot',
         assigned_agent_id = null,
         bot_resume_at     = null
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason)
  values (p_conversation_id, v_before, 'bot', 'agent', v_agent, p_reason);

  return v_row;
end;
$$;

comment on function chat.hand_back is 'Devolve a conversa para a automação do n8n.';

-- -----------------------------------------------------------------------------
-- Devolução automática — chamada por um cron (pg_cron ou workflow do n8n)
-- -----------------------------------------------------------------------------

create or replace function chat.auto_hand_back_expired()
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_count integer := 0;
  v_id    uuid;
begin
  for v_id in
    select id from chat.conversations
     where mode = 'human'
       and bot_resume_at is not null
       and bot_resume_at <= now()
     for update skip locked
  loop
    update chat.conversations
       set mode = 'bot', assigned_agent_id = null, bot_resume_at = null
     where id = v_id;

    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason)
    values (v_id, 'human', 'bot', 'system', 'Devolução automática por tempo');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function chat.auto_hand_back_expired is
  'Devolve ao bot toda conversa humana cujo bot_resume_at venceu. Rodar de minuto em minuto.';

-- -----------------------------------------------------------------------------
-- Marcar conversa como lida
-- -----------------------------------------------------------------------------

create or replace function chat.mark_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = chat, public
as $$
  update chat.conversations set unread_count = 0 where id = p_conversation_id;
$$;

-- -----------------------------------------------------------------------------
-- Upsert de contato + conversa — usado pelo webhook a cada mensagem entrante.
-- Resolve tudo numa ida ao banco e é idempotente.
-- -----------------------------------------------------------------------------

create or replace function chat.resolve_conversation(
  p_channel_id   uuid,
  p_wa_id        text,
  p_profile_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_contact_id      uuid;
  v_conversation_id uuid;
begin
  insert into chat.contacts (channel_id, wa_id, profile_name)
  values (p_channel_id, p_wa_id, p_profile_name)
  on conflict (channel_id, wa_id) do update
    set profile_name = coalesce(excluded.profile_name, chat.contacts.profile_name)
  returning id into v_contact_id;

  insert into chat.conversations (channel_id, contact_id)
  values (p_channel_id, v_contact_id)
  on conflict (contact_id) do update
    set updated_at = now()
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contagem de variáveis {{n}} do template, mantida em cache
-- -----------------------------------------------------------------------------

create or replace function chat.sync_template_variable_count()
returns trigger
language plpgsql
as $$
declare
  v_body text;
  v_max  integer := 0;
  v_match text;
begin
  select comp ->> 'text' into v_body
    from jsonb_array_elements(new.components) comp
   where upper(comp ->> 'type') = 'BODY'
   limit 1;

  if v_body is not null then
    for v_match in select (regexp_matches(v_body, '\{\{(\d+)\}\}', 'g'))[1] loop
      v_max := greatest(v_max, v_match::integer);
    end loop;
  end if;

  new.variable_count := v_max;
  return new;
end;
$$;

drop trigger if exists trg_template_var_count on chat.templates;
create trigger trg_template_var_count
  before insert or update of components on chat.templates
  for each row execute function chat.sync_template_variable_count();

-- -----------------------------------------------------------------------------
-- View do inbox: tudo que a lista de conversas precisa, sem N+1
-- -----------------------------------------------------------------------------

create or replace view chat.inbox as
select
  c.id                    as conversation_id,
  c.channel_id,
  c.status,
  c.mode,
  c.assigned_agent_id,
  a.full_name             as assigned_agent_name,
  c.unread_count,
  c.last_message_at,
  c.last_message_preview,
  c.window_expires_at,
  (c.window_expires_at > now()) as within_window,
  c.bot_resume_at,
  ct.id                   as contact_id,
  ct.wa_id,
  coalesce(ct.display_name, ct.profile_name, ct.wa_id) as contact_name,
  ct.tags,
  ch.name                 as channel_name,
  ch.display_phone_number
from chat.conversations c
join chat.contacts  ct on ct.id = c.contact_id
join chat.channels  ch on ch.id = c.channel_id
left join chat.agents a on a.id = c.assigned_agent_id;

comment on view chat.inbox is 'Lista de conversas pronta para o painel, já com contato, canal e status da janela.';
