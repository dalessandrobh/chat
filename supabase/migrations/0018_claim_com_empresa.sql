-- =============================================================================
-- 0018 — A reserva de envio devolve a empresa
-- =============================================================================
-- Quem envia precisa saber de quem é o envio: o descadastro por falha (número
-- sem WhatsApp, recusa do provedor) tem de cair na lista daquela empresa e de
-- mais nenhuma. Sem esta coluna, o servidor não teria como saber — ele age com
-- chave de serviço, que ignora a RLS.

drop function if exists chat.claim_next_send();

CREATE OR REPLACE FUNCTION chat.claim_next_send()
 RETURNS TABLE(recipient_id uuid, campaign_id uuid, channel_id uuid, company_id uuid, wa_id text, name text, media_kind chat.campaign_media, body text, media_url text, media_filename text, media_mime text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'chat', 'public'
AS $function$
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
    -- Canal pausado no painel não dispara. É o mesmo botão que cala o bot:
    -- pausar um número precisa calar tudo que sai dele sozinho, senão
    -- "pausado" quer dizer uma coisa no atendimento e outra na campanha.
    if not exists (
      select 1 from chat.channels ch
       where ch.id = c.channel_id and ch.is_active
    ) then
      continue;
    end if;

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
      returning r.id, c.id, c.channel_id, c.company_id, r.wa_id, r.name,
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
$function$;

grant execute on function chat.claim_next_send() to service_role;
