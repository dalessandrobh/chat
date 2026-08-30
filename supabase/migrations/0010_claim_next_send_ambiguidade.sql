-- =============================================================================
-- 0010 — Conserta chat.claim_next_send()
-- =============================================================================
-- Dois defeitos, ambos silenciosos até a fila realmente andar:
--
-- 1. `campaign_id`, `name`, `body` e companhia são parâmetros OUT do RETURNS
--    TABLE, então valem como variáveis dentro do corpo. Qualquer referência
--    não qualificada a essas colunas estourava "column reference is ambiguous"
--    no primeiro envio elegível. Agora toda coluna leva o alias da tabela.
--
-- 2. O dia da semana usava `dow` (0 = domingo). É a convenção do Postgres, mas
--    não a de quem lê: uma tela que ofereça "domingo" grava 7, e 7 nunca casa
--    com dow — a campanha travaria sem erro nenhum. Passa a `isodow`
--    (1 = segunda … 7 = domingo). O padrão {1..6} continua sendo seg–sáb.

comment on column chat.campaigns.weekdays is
  'Dias permitidos em ISO: 1 = segunda … 7 = domingo. Padrão exclui o domingo.';

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
       or not (extract(isodow from v_agora at time zone 'America/Sao_Paulo')::integer = any(c.weekdays))
    then
      continue;
    end if;

    -- Teto do dia, por campanha.
    select count(*) into v_hoje
      from chat.campaign_recipients cr
     where cr.campaign_id = c.id
       and cr.sent_at >= date_trunc('day', v_agora at time zone 'America/Sao_Paulo')
                           at time zone 'America/Sao_Paulo';
    if v_hoje >= c.daily_limit then
      continue;
    end if;

    -- Intervalo medido sobre o CANAL, não sobre a campanha: duas campanhas no
    -- mesmo número dobrariam a cadência e é o número que é banido, não a
    -- campanha.
    select max(cr.sent_at) into v_ultimo
      from chat.campaign_recipients cr
      join chat.campaigns cc on cc.id = cr.campaign_id
     where cc.channel_id = c.channel_id and cr.sent_at is not null;

    -- Sorteio a cada passo: cadência exata é assinatura de robô.
    v_gap := c.interval_min_seconds
             + floor(random() * (c.interval_max_seconds - c.interval_min_seconds + 1))::integer;

    if v_ultimo is not null and v_agora < v_ultimo + make_interval(secs => v_gap) then
      continue;
    end if;

    -- Destinatário que ainda pode receber.
    return query
      with escolhido as (
        select cr.id
          from chat.campaign_recipients cr
          join chat.audience a on a.id = cr.audience_id
         where cr.campaign_id = c.id
           and cr.status = 'pending'
           and a.is_sendable
         order by cr.created_at
         for update of cr skip locked
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
      select 1 from chat.campaign_recipients cr
       where cr.campaign_id = c.id and cr.status = 'pending'
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
