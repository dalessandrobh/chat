-- =============================================================================
-- 0009 — Ritmo, opt-out e painel das campanhas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SAIR DA LISTA
-- -----------------------------------------------------------------------------

create or replace function chat.opt_out(p_wa_id text, p_reason chat.unsendable_reason default 'opt_out')
returns boolean
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_mudou boolean := false;
begin
  update chat.audience
     set is_sendable = false,
         unsendable_reason = p_reason,
         unsendable_at = now()
   where wa_id = p_wa_id and is_sendable
  returning true into v_mudou;

  -- Quem já estava na fila de uma campanha sai dela também. Sem isto, alguém
  -- que pede para sair às 10h ainda recebe o disparo das 11h.
  update chat.campaign_recipients r
     set status = 'skipped'
    from chat.campaigns c
   where r.campaign_id = c.id
     and r.wa_id = p_wa_id
     and r.status = 'pending';

  return coalesce(v_mudou, false);
end;
$$;

comment on function chat.opt_out is
  'Tira da lista de envio e limpa filas pendentes. A linha continua na base.';

-- -----------------------------------------------------------------------------
-- MONTAR A CAMPANHA
-- -----------------------------------------------------------------------------

create or replace function chat.enqueue_campaign(p_campaign_id uuid, p_tags text[] default null)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_total integer;
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores montam campanhas'
      using errcode = 'insufficient_privilege';
  end if;

  -- Só quem pode receber. Quem saiu da lista nunca entra na fila.
  insert into chat.campaign_recipients (campaign_id, audience_id, name, wa_id)
  select p_campaign_id, a.id, a.name, a.wa_id
    from chat.audience a
   where a.is_sendable
     and (p_tags is null or a.tags && p_tags)
  on conflict (campaign_id, audience_id) do nothing;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- RITMO
-- -----------------------------------------------------------------------------
-- Reserva UM destinatário por vez, e só se todas as travas permitirem.
-- Marcar como 'sent' antes de chamar a API é deliberado: se o processo morrer
-- entre a reserva e o envio, o pior caso vira uma mensagem não enviada em vez
-- de uma mensagem enviada duas vezes. Cliente recebendo promoção repetida é o
-- que gera denúncia, e denúncia é o que queima o número.

create or replace function chat.claim_next_send()
returns table (
  recipient_id  uuid,
  campaign_id   uuid,
  channel_id    uuid,
  wa_id         text,
  name          text,
  media_kind    chat.campaign_media,
  body          text,
  media_url     text,
  media_filename text,
  media_mime    text
)
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  c            record;
  v_gap        integer;
  v_ultimo     timestamptz;
  v_hoje       integer;
  v_agora      timestamptz := now();
begin
  -- Agendadas que chegaram a hora viram correntes.
  update chat.campaigns
     set status = 'running', started_at = coalesce(started_at, v_agora)
   where status = 'scheduled' and scheduled_at <= v_agora;

  for c in
    select * from chat.campaigns
     where status = 'running'
     order by scheduled_at nulls last, created_at
  loop
    -- Fora da janela de horário ou do dia da semana: passa para a próxima.
    if (v_agora at time zone 'America/Sao_Paulo')::time
         not between c.window_start and c.window_end
       or not (extract(dow from v_agora at time zone 'America/Sao_Paulo')::integer = any(c.weekdays))
    then
      continue;
    end if;

    -- Teto do dia, por campanha.
    select count(*) into v_hoje
      from chat.campaign_recipients
     where campaign_id = c.id
       and sent_at >= date_trunc('day', v_agora at time zone 'America/Sao_Paulo')
                        at time zone 'America/Sao_Paulo';
    if v_hoje >= c.daily_limit then
      continue;
    end if;

    -- Intervalo medido sobre o CANAL, não sobre a campanha: duas campanhas no
    -- mesmo número dobrariam a cadência e é o número que é banido, não a
    -- campanha.
    select max(r.sent_at) into v_ultimo
      from chat.campaign_recipients r
      join chat.campaigns cc on cc.id = r.campaign_id
     where cc.channel_id = c.channel_id and r.sent_at is not null;

    -- Sorteio a cada passo: cadência exata é assinatura de robô.
    v_gap := c.interval_min_seconds
             + floor(random() * (c.interval_max_seconds - c.interval_min_seconds + 1))::integer;

    if v_ultimo is not null and v_agora < v_ultimo + make_interval(secs => v_gap) then
      continue;
    end if;

    -- Destinatário que ainda pode receber.
    return query
      with escolhido as (
        select r.id
          from chat.campaign_recipients r
          join chat.audience a on a.id = r.audience_id
         where r.campaign_id = c.id
           and r.status = 'pending'
           and a.is_sendable
         order by r.created_at
         for update of r skip locked
         limit 1
      )
      update chat.campaign_recipients r
         set status = 'sent', sent_at = v_agora
        from escolhido e
       where r.id = e.id
      returning r.id, c.id, c.channel_id, r.wa_id, r.name,
                c.media_kind, c.body, c.media_url, c.media_filename, c.media_mime;

    if found then
      return;
    end if;

    -- Nada pendente elegível: se também não sobrou nada, a campanha acabou.
    if not exists (
      select 1 from chat.campaign_recipients
       where campaign_id = c.id and status = 'pending'
    ) then
      update chat.campaigns
         set status = 'done', finished_at = v_agora
       where id = c.id;
    end if;
  end loop;

  return;
end;
$$;

comment on function chat.claim_next_send is
  'Reserva um envio respeitando janela, teto diário e intervalo por canal. '
  'Marca como enviado ANTES da chamada à API: repetir mensagem é pior que perder uma.';

-- -----------------------------------------------------------------------------
-- PAINEL
-- -----------------------------------------------------------------------------

create or replace view chat.campaign_stats as
select
  c.id            as campaign_id,
  c.name,
  c.status,
  c.media_kind,
  c.scheduled_at,
  c.started_at,
  c.finished_at,
  c.daily_limit,
  c.interval_min_seconds,
  c.interval_max_seconds,
  count(r.id)                                             as total,
  count(*) filter (where r.status = 'pending')            as pendentes,
  count(*) filter (where r.status = 'sent')               as a_caminho,
  count(*) filter (where r.status in ('delivered','read')) as entregues,
  count(*) filter (where r.status = 'read')               as lidas,
  count(*) filter (where r.status = 'failed')             as falharam,
  count(*) filter (where r.status = 'skipped')            as ignorados
from chat.campaigns c
left join chat.campaign_recipients r on r.campaign_id = c.id
group by c.id;

comment on view chat.campaign_stats is
  'Números por campanha. "a_caminho" é trânsito, não dúvida: sempre vira entregue ou falhou.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table chat.audience             enable row level security;
alter table chat.campaigns            enable row level security;
alter table chat.campaign_recipients  enable row level security;

grant select on chat.audience, chat.campaigns, chat.campaign_recipients, chat.campaign_stats to authenticated;
grant all    on chat.audience, chat.campaigns, chat.campaign_recipients to service_role;
grant select on chat.campaign_stats to service_role;
grant execute on function chat.opt_out(text, chat.unsendable_reason) to service_role;
grant execute on function chat.enqueue_campaign(uuid, text[]) to authenticated, service_role;
grant execute on function chat.claim_next_send() to service_role;

drop policy if exists audience_select on chat.audience;
create policy audience_select on chat.audience
  for select to authenticated using (chat.is_active_agent());
drop policy if exists audience_write on chat.audience;
create policy audience_write on chat.audience
  for all to authenticated using (chat.is_manager()) with check (chat.is_manager());

drop policy if exists campaigns_select on chat.campaigns;
create policy campaigns_select on chat.campaigns
  for select to authenticated using (chat.is_active_agent());
drop policy if exists campaigns_write on chat.campaigns;
create policy campaigns_write on chat.campaigns
  for all to authenticated using (chat.is_manager()) with check (chat.is_manager());

drop policy if exists recipients_select on chat.campaign_recipients;
create policy recipients_select on chat.campaign_recipients
  for select to authenticated using (chat.is_active_agent());
drop policy if exists recipients_write on chat.campaign_recipients;
create policy recipients_write on chat.campaign_recipients
  for all to authenticated using (chat.is_manager()) with check (chat.is_manager());
