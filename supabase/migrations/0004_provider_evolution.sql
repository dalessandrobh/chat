-- =============================================================================
-- 0004 — Suporte a múltiplos provedores de WhatsApp
-- =============================================================================
-- O schema nasceu assumindo a Meta Cloud API: waba_id e phone_number_id eram
-- obrigatórios. Entra a Evolution API (Baileys), que não tem nenhum dos dois —
-- ela identifica o número por um nome de instância.
--
-- A coluna chat.channels.provider já existia. Aqui ela ganha dentes.

-- -----------------------------------------------------------------------------
-- CHANNELS
-- -----------------------------------------------------------------------------

alter table chat.channels alter column waba_id          drop not null;
alter table chat.channels alter column phone_number_id  drop not null;

alter table chat.channels add column if not exists instance_name    text;
alter table chat.channels add column if not exists connection_state text not null default 'unknown';
alter table chat.channels add column if not exists connected_at     timestamptz;

comment on column chat.channels.instance_name is
  'Nome da instância na Evolution API. Nulo para canais meta_cloud.';
comment on column chat.channels.connection_state is
  'Estado do pareamento na Evolution: open | connecting | close | unknown. '
  'Para meta_cloud fica sempre "open" — não existe sessão para cair.';

-- Nome de instância é chave na Evolution: dois canais não podem compartilhar.
create unique index if not exists channels_instance_name_key
  on chat.channels (instance_name) where instance_name is not null;

alter table chat.channels drop constraint if exists channels_provider_check;
alter table chat.channels add  constraint channels_provider_check
  check (provider in ('meta_cloud', 'evolution'));

-- Cada provedor precisa da sua própria identidade. Sem isso dá para cadastrar
-- um canal evolution sem instância e só descobrir quando a mensagem chegar.
alter table chat.channels drop constraint if exists channels_identity_check;
alter table chat.channels add  constraint channels_identity_check check (
  (provider = 'meta_cloud' and phone_number_id is not null and waba_id is not null)
  or
  (provider = 'evolution'  and instance_name is not null)
);

-- -----------------------------------------------------------------------------
-- JANELA DE 24H
-- -----------------------------------------------------------------------------
-- A janela é uma regra da Meta, não do WhatsApp. Em canal evolution ela não
-- existe: dá para mandar texto a qualquer hora. Como o painel e o composer
-- decidem pela flag, a regra tem que morrer aqui, num lugar só, e não em
-- cada tela.

create or replace function chat.is_within_window(p_conversation_id uuid)
returns boolean
language sql
stable
as $$
  select case
           when ch.provider = 'evolution' then true
           else coalesce(c.window_expires_at > now(), false)
         end
    from chat.conversations c
    join chat.channels ch on ch.id = c.channel_id
   where c.id = p_conversation_id;
$$;

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
  case
    when ch.provider = 'evolution' then true
    else (c.window_expires_at > now())
  end                     as within_window,
  c.bot_resume_at,
  ct.id                   as contact_id,
  ct.wa_id,
  coalesce(ct.display_name, ct.profile_name, ct.wa_id) as contact_name,
  ct.tags,
  ch.name                 as channel_name,
  ch.display_phone_number,
  -- Coluna nova vai no fim: create or replace view não deixa inserir no meio.
  ch.provider
from chat.conversations c
join chat.contacts  ct on ct.id = c.contact_id
join chat.channels  ch on ch.id = c.channel_id
left join chat.agents a on a.id = c.assigned_agent_id;

comment on view chat.inbox is
  'Lista de conversas pronta para o painel. within_window já considera o provedor.';

-- -----------------------------------------------------------------------------
-- TEMPLATES
-- -----------------------------------------------------------------------------
-- Sem Meta não há aprovação: o template vira texto pronto com {{n}}, útil do
-- mesmo jeito para o atendente. O status LOCAL já existia no enum; agora ele
-- passa a ser o padrão de quem nasce num canal evolution.

comment on column chat.templates.status is
  'APPROVED/PENDING/REJECTED vêm da Meta. LOCAL é template de canal evolution, '
  'que não passa por aprovação nenhuma.';

-- -----------------------------------------------------------------------------
-- HANDOFF DISPARADO DE FORA DO PAINEL
-- -----------------------------------------------------------------------------
-- Na Evolution o dono continua com o WhatsApp no celular — é justamente o que
-- se ganha ao abrir mão da API oficial. Quando ele responde por lá, o webhook
-- avisa, e o bot precisa calar a boca: duas vozes na mesma conversa é pior do
-- que não ter bot.
--
-- chat.take_over() não serve aqui porque exige auth.uid(), e quem chama é o
-- service_role do webhook, sem usuário. Daí uma função irmã, sem agente
-- associado: ninguém no painel "pegou" essa conversa, ela está sendo atendida
-- no aparelho.

create or replace function chat.take_over_external(
  p_conversation_id uuid,
  p_reason          text default null
)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_before chat.conversation_mode;
  v_row    chat.conversations;
begin
  select mode into v_before from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

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

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason)
  values (p_conversation_id, v_before, 'human', 'system', p_reason);

  return v_row;
end;
$$;

comment on function chat.take_over_external is
  'Pausa o bot sem agente do painel. Usado quando o dono responde pelo próprio '
  'WhatsApp: a conversa vira humana e só volta ao bot por hand_back() explícito.';

revoke all on function chat.take_over_external(uuid, text) from public, anon, authenticated;
grant execute on function chat.take_over_external(uuid, text) to service_role;
