-- =============================================================================
-- Projeto Chat — schema base
-- Plataforma de automação + atendimento humano para WhatsApp Cloud API (Meta)
-- =============================================================================
-- Convenção: tudo vive no schema `chat`, isolado do `public` e do `dsearch`.

create schema if not exists chat;

comment on schema chat is 'Projeto Chat: automações e atendimento WhatsApp (Meta Cloud API)';

-- Extensões usadas (já presentes no Supabase, mas garantimos)
create extension if not exists "pgcrypto" with schema extensions;

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

do $$ begin
  create type chat.conversation_mode as enum ('bot', 'human');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.conversation_status as enum ('open', 'pending', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.message_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.message_author as enum ('contact', 'bot', 'agent', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.template_status as enum (
    'LOCAL', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.template_category as enum ('MARKETING', 'UTILITY', 'AUTHENTICATION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.agent_role as enum ('owner', 'admin', 'agent', 'viewer');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------

create or replace function chat.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- AGENTS — perfil dos operadores, espelha auth.users
-- -----------------------------------------------------------------------------

create table if not exists chat.agents (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  email        text,
  avatar_url   text,
  role         chat.agent_role not null default 'agent',
  -- Nasce INATIVO de propósito. Este Supabase é compartilhado com outros
  -- projetos: sem isso, qualquer cadastro novo em outro app viraria um
  -- agente com acesso ao painel do Chat.
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table chat.agents is 'Operadores humanos do painel. 1:1 com auth.users.';

drop trigger if exists trg_agents_touch on chat.agents;
create trigger trg_agents_touch before update on chat.agents
  for each row execute function chat.touch_updated_at();

-- Cria o perfil automaticamente quando alguém se cadastra no Supabase Auth.
create or replace function chat.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = chat, public
as $$
begin
  insert into chat.agents (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function chat.handle_new_user();

-- -----------------------------------------------------------------------------
-- CHANNELS — cada número WhatsApp conectado
-- -----------------------------------------------------------------------------

create table if not exists chat.channels (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  provider              text not null default 'meta_cloud',
  waba_id               text not null,
  phone_number_id       text not null,
  display_phone_number  text,
  -- Segredos NÃO ficam aqui: o access token vive no Vault / env do app.
  -- Guardamos só a referência lógica para multi-número no futuro.
  token_ref             text,
  is_active             boolean not null default true,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint channels_phone_number_id_key unique (phone_number_id)
);

comment on table chat.channels is 'Números WhatsApp (phone_number_id da Meta Cloud API).';
comment on column chat.channels.token_ref is 'Nome da chave no Vault/env que guarda o access token. Nunca o token em si.';

drop trigger if exists trg_channels_touch on chat.channels;
create trigger trg_channels_touch before update on chat.channels
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- CONTACTS
-- -----------------------------------------------------------------------------

create table if not exists chat.contacts (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references chat.channels(id) on delete cascade,
  wa_id         text not null,              -- E.164 sem '+', como a Meta entrega
  profile_name  text,                        -- nome que o próprio contato usa
  display_name  text,                        -- nome editável pelo agente
  tags          text[] not null default '{}',
  is_blocked    boolean not null default false,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint contacts_channel_wa_id_key unique (channel_id, wa_id)
);

comment on column chat.contacts.wa_id is 'Número no formato da Meta: E.164 sem o +. Ex: 5511999998888';

create index if not exists idx_contacts_wa_id on chat.contacts (wa_id);
create index if not exists idx_contacts_tags on chat.contacts using gin (tags);

drop trigger if exists trg_contacts_touch on chat.contacts;
create trigger trg_contacts_touch before update on chat.contacts
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- TEMPLATES — espelho local dos message templates da Meta
-- -----------------------------------------------------------------------------

create table if not exists chat.templates (
  id                 uuid primary key default gen_random_uuid(),
  channel_id         uuid not null references chat.channels(id) on delete cascade,
  name               text not null,
  language           text not null default 'pt_BR',
  category           chat.template_category not null default 'UTILITY',
  -- Estrutura exata que a Meta espera em POST /{waba_id}/message_templates
  components         jsonb not null default '[]'::jsonb,
  meta_template_id   text,
  status             chat.template_status not null default 'LOCAL',
  quality_rating     text,
  rejected_reason    text,
  -- Cache: quantas variáveis {{n}} o corpo espera, para o painel validar o envio
  variable_count     integer not null default 0,
  last_synced_at     timestamptz,
  created_by         uuid references chat.agents(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint templates_name_lang_key unique (channel_id, name, language),
  -- A Meta só aceita nomes em snake_case minúsculo, com até 512 caracteres.
  -- O limite de tamanho vai separado porque o regex do Postgres não aceita
  -- contagem de repetição acima de 255.
  constraint templates_name_format check (name ~ '^[a-z0-9_]+$'),
  constraint templates_name_length check (char_length(name) between 1 and 512)
);

comment on table chat.templates is 'Templates HSM. `status` reflete a aprovação na Meta; LOCAL = rascunho ainda não enviado.';
comment on column chat.templates.components is 'Array de componentes no formato da Graph API: HEADER/BODY/FOOTER/BUTTONS.';

create index if not exists idx_templates_status on chat.templates (status);
create index if not exists idx_templates_channel on chat.templates (channel_id);

drop trigger if exists trg_templates_touch on chat.templates;
create trigger trg_templates_touch before update on chat.templates
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- CONVERSATIONS — o núcleo do controle bot ↔ humano
-- -----------------------------------------------------------------------------

create table if not exists chat.conversations (
  id                 uuid primary key default gen_random_uuid(),
  channel_id         uuid not null references chat.channels(id) on delete cascade,
  contact_id         uuid not null references chat.contacts(id) on delete cascade,

  status             chat.conversation_status not null default 'open',
  mode               chat.conversation_mode not null default 'bot',
  assigned_agent_id  uuid references chat.agents(id) on delete set null,

  -- Janela de 24h da Meta: fora dela só é possível enviar template aprovado.
  last_inbound_at    timestamptz,
  last_outbound_at   timestamptz,
  last_message_at    timestamptz,
  window_expires_at  timestamptz,

  -- Devolução automática ao bot: se preenchido e já passou, um job devolve.
  bot_resume_at      timestamptz,

  unread_count       integer not null default 0,
  last_message_preview text,

  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint conversations_contact_key unique (contact_id)
);

comment on table chat.conversations is 'Uma conversa por contato. `mode` decide quem responde: bot ou humano.';
comment on column chat.conversations.mode is 'bot = automação responde; human = agente assumiu, bot fica mudo.';
comment on column chat.conversations.window_expires_at is 'last_inbound_at + 24h. Depois disso, só template aprovado.';
comment on column chat.conversations.bot_resume_at is 'Se setado, a conversa volta sozinha para o bot nesse horário.';

create index if not exists idx_conversations_status_mode on chat.conversations (status, mode);
create index if not exists idx_conversations_last_message on chat.conversations (last_message_at desc nulls last);
create index if not exists idx_conversations_assigned on chat.conversations (assigned_agent_id) where assigned_agent_id is not null;
create index if not exists idx_conversations_bot_resume on chat.conversations (bot_resume_at) where bot_resume_at is not null;

drop trigger if exists trg_conversations_touch on chat.conversations;
create trigger trg_conversations_touch before update on chat.conversations
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- MESSAGES
-- -----------------------------------------------------------------------------

create table if not exists chat.messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references chat.conversations(id) on delete cascade,
  channel_id         uuid not null references chat.channels(id) on delete cascade,

  direction          chat.message_direction not null,
  wa_message_id      text,                   -- wamid.* devolvido pela Meta
  type               text not null default 'text',
  body               text,                   -- texto plano, para busca e preview
  payload            jsonb not null default '{}'::jsonb,  -- conteúdo normalizado
  media              jsonb,                  -- {media_id, mime_type, sha256, storage_path, filename}

  template_id        uuid references chat.templates(id) on delete set null,
  template_variables jsonb,

  status             chat.message_status not null default 'queued',
  error              jsonb,

  author             chat.message_author not null,
  agent_id           uuid references chat.agents(id) on delete set null,
  replied_to_wa_id   text,

  created_at         timestamptz not null default now(),
  sent_at            timestamptz,
  delivered_at       timestamptz,
  read_at            timestamptz,

  constraint messages_wa_message_id_key unique (wa_message_id)
);

comment on table chat.messages is 'Todas as mensagens, entrantes e saintes, de qualquer autor (contato/bot/agente).';
comment on column chat.messages.author is 'Quem produziu: contact (recebida), bot (automação), agent (humano), system (nota interna).';

create index if not exists idx_messages_conversation on chat.messages (conversation_id, created_at desc);
create index if not exists idx_messages_status on chat.messages (status) where status in ('queued', 'failed');
create index if not exists idx_messages_body_fts on chat.messages
  using gin (to_tsvector('portuguese', coalesce(body, '')));

-- -----------------------------------------------------------------------------
-- HANDOFF EVENTS — auditoria de quem assumiu/devolveu e quando
-- -----------------------------------------------------------------------------

create table if not exists chat.handoff_events (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references chat.conversations(id) on delete cascade,
  from_mode        chat.conversation_mode,
  to_mode          chat.conversation_mode not null,
  actor            chat.message_author not null default 'agent',
  agent_id         uuid references chat.agents(id) on delete set null,
  reason           text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_handoff_conversation on chat.handoff_events (conversation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- WEBHOOK EVENTS — idempotência e replay
-- -----------------------------------------------------------------------------

create table if not exists chat.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'meta_cloud',
  event_key     text not null,       -- wamid ou hash do payload
  event_type    text,                -- messages | statuses | template_status
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text,
  constraint webhook_events_key_unique unique (provider, event_key)
);

comment on table chat.webhook_events is 'Log cru dos webhooks da Meta. `event_key` único garante idempotência em reentrega.';

create index if not exists idx_webhook_unprocessed on chat.webhook_events (received_at)
  where processed_at is null;
