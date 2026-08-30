-- =============================================================================
-- 0008 — Campanhas agendadas
-- =============================================================================
-- Três tabelas com papéis distintos, e a distinção importa:
--
--   audience            a base da empresa. Nunca perde linha.
--   campaigns           uma mensagem agendada.
--   campaign_recipients quem aquela campanha mirou, e o que aconteceu com cada um.
--
-- "Tirar da lista de envio sem tirar da base" é exatamente a diferença entre
-- `audience.is_sendable = false` e `delete from audience`. O histórico de por
-- que alguém saiu é o que evita recadastrar o mesmo número que já falhou três
-- vezes.

-- -----------------------------------------------------------------------------
-- BASE DE ENVIO
-- -----------------------------------------------------------------------------

do $$ begin
  create type chat.unsendable_reason as enum (
    'opt_out',        -- pediu para não receber mais
    'no_whatsapp',    -- número não existe no WhatsApp
    'send_failed',    -- falhou no envio e não vale insistir
    'manual'          -- alguém desmarcou na mão
  );
exception when duplicate_object then null; end $$;

create table if not exists chat.audience (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  wa_id         text not null,                 -- E.164 sem '+', como no resto do schema
  tags          text[] not null default '{}',
  -- Falso tira das campanhas e mantém a linha. É o coração do requisito.
  is_sendable   boolean not null default true,
  unsendable_reason chat.unsendable_reason,
  unsendable_at timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint audience_wa_id_key unique (wa_id),
  constraint audience_name_len check (char_length(name) between 1 and 200),
  -- E.164 sem símbolos. Barra na entrada em vez de descobrir no disparo.
  constraint audience_wa_id_format check (wa_id ~ '^[1-9][0-9]{7,14}$'),
  constraint audience_reason_coerente check (
    (is_sendable and unsendable_reason is null and unsendable_at is null)
    or (not is_sendable and unsendable_reason is not null)
  )
);

comment on table chat.audience is
  'Base de envio da empresa. Linha nunca é apagada por falha ou opt-out: só marcada.';
comment on column chat.audience.is_sendable is
  'Falso = fora das campanhas, dentro da base. Ver unsendable_reason.';

create index if not exists idx_audience_envio on chat.audience (is_sendable) where is_sendable;
create index if not exists idx_audience_tags on chat.audience using gin (tags);

drop trigger if exists trg_audience_touch on chat.audience;
create trigger trg_audience_touch before update on chat.audience
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- CAMPANHAS
-- -----------------------------------------------------------------------------

do $$ begin
  create type chat.campaign_status as enum (
    'draft', 'scheduled', 'running', 'paused', 'done', 'canceled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type chat.campaign_media as enum ('text', 'image', 'video', 'audio', 'document');
exception when duplicate_object then null; end $$;

create table if not exists chat.campaigns (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references chat.channels(id) on delete cascade,
  name          text not null,
  status        chat.campaign_status not null default 'draft',
  media_kind    chat.campaign_media not null default 'text',
  -- Texto puro, ou legenda da mídia. Áudio não tem legenda.
  body          text,
  media_url     text,
  media_filename text,
  media_mime    text,
  scheduled_at  timestamptz,

  -- --- Ritmo. Padrões conservadores de propósito. ---
  -- Intervalo sorteado entre mínimo e máximo a cada envio: cadência exata é
  -- assinatura de robô, e é o que os sistemas antifraude procuram primeiro.
  interval_min_seconds integer not null default 45,
  interval_max_seconds integer not null default 120,
  -- Teto diário por campanha. 200 já é agressivo para um número novo.
  daily_limit          integer not null default 150,
  -- Janela de envio, no fuso do canal. Ninguém recebe promoção às 3h.
  window_start  time not null default '09:00',
  window_end    time not null default '19:00',
  -- Domingo fora por padrão (0 = domingo).
  weekdays      integer[] not null default '{1,2,3,4,5,6}',

  started_at    timestamptz,
  finished_at   timestamptz,
  created_by    uuid references chat.agents(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint campaigns_name_len check (char_length(name) between 1 and 160),
  constraint campaigns_intervalo check (interval_min_seconds between 5 and 3600
                                    and interval_max_seconds between interval_min_seconds and 7200),
  constraint campaigns_limite check (daily_limit between 1 and 1000),
  constraint campaigns_janela check (window_start < window_end),
  -- Texto exige corpo; mídia exige arquivo.
  constraint campaigns_conteudo check (
    (media_kind = 'text'  and coalesce(body, '') <> '')
    or (media_kind <> 'text' and coalesce(media_url, '') <> '')
  )
);

comment on table chat.campaigns is 'Mensagem agendada para um recorte da base.';
comment on column chat.campaigns.interval_min_seconds is
  'Intervalo é sorteado nesta faixa a cada envio. Cadência fixa denuncia automação.';

create index if not exists idx_campaigns_devidas
  on chat.campaigns (status, scheduled_at) where status in ('scheduled', 'running');

drop trigger if exists trg_campaigns_touch on chat.campaigns;
create trigger trg_campaigns_touch before update on chat.campaigns
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- DESTINATÁRIOS
-- -----------------------------------------------------------------------------
-- Sem status "inconclusivo": no Baileys todo envio termina resolvido. Ou a API
-- recusa na hora (failed), ou aceita e o WhatsApp confirma a entrega por
-- webhook (delivered/read). `sent` é estado de trânsito, não de dúvida — ele
-- sempre vira outra coisa.

do $$ begin
  create type chat.recipient_status as enum (
    'pending',    -- na fila
    'sent',       -- a API aceitou, aguardando confirmação do WhatsApp
    'delivered',  -- entregue no aparelho
    'read',       -- lida
    'failed',     -- recusada, ou número sem WhatsApp
    'skipped'     -- saiu da base entre o agendamento e o disparo
  );
exception when duplicate_object then null; end $$;

create table if not exists chat.campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references chat.campaigns(id) on delete cascade,
  audience_id   uuid not null references chat.audience(id) on delete cascade,
  -- Nome e número copiados no agendamento: o relatório precisa mostrar para
  -- quem foi de verdade, mesmo que a base mude depois.
  name          text not null,
  wa_id         text not null,
  status        chat.recipient_status not null default 'pending',
  wa_message_id text,
  message_id    uuid references chat.messages(id) on delete set null,
  error         text,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  failed_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint campaign_recipients_unico unique (campaign_id, audience_id)
);

comment on table chat.campaign_recipients is
  'Um destinatário de uma campanha. Sem estado "inconclusivo": sent sempre resolve.';

create index if not exists idx_recipients_fila
  on chat.campaign_recipients (campaign_id, status) where status = 'pending';
create index if not exists idx_recipients_wamid
  on chat.campaign_recipients (wa_message_id) where wa_message_id is not null;
