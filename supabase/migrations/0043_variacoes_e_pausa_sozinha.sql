-- =============================================================================
-- 0043 — Variações do texto, e a campanha que pausa sozinha
-- =============================================================================
-- O número das campanhas foi removido do WhatsApp duas vezes — 10/09 e 14/09 —,
-- as duas no meio de um disparo, as duas com o mesmo erro: `stream:error`
-- código 401 com `conflict type="device_removed"`. Na segunda vez os números
-- inválidos já não explicavam nada (1 em 57). O que sobra é o perfil do envio.
--
-- Duas coisas que estavam na nossa mão e não estavam feitas:
--
-- 1. **O texto era idêntico byte a byte** para a lista inteira. `{nome}` varia
--    a primeira palavra e mais nada; 180 mensagens com a mesma assinatura são
--    uma assinatura. Agora a campanha guarda variações, e cada envio sorteia
--    uma.
--
-- 2. **A campanha ia até o fim mesmo falando sozinha.** Em 14/09 saíram 57
--    mensagens em 1h49 com 11 entregas confirmadas; um número que a plataforma
--    já está segurando parece exatamente com isso. Ninguém responder depois de
--    dezenas de envios é o sinal mais barato que existe, e ele chegava tarde
--    demais — quando alguém abria a tela.

begin;

alter table chat.campaigns
  add column if not exists variacoes    text[] not null default '{}',
  add column if not exists pausa_motivo text;

comment on column chat.campaigns.variacoes is
  'Outras redações da mesma mensagem. Cada envio sorteia entre body e estas.';
comment on column chat.campaigns.pausa_motivo is
  'Por que a campanha se pausou sozinha. Nulo quando quem pausou foi gente.';

-- Teto de 4 variações e do mesmo tamanho do corpo: é escrita à mão, não
-- geração. Quem precisa de dez redações está resolvendo outro problema.
alter table chat.campaigns
  drop constraint if exists campaigns_variacoes;
alter table chat.campaigns
  add constraint campaigns_variacoes check (
    cardinality(variacoes) <= 4
    and array_position(variacoes, '') is null
    and char_length(array_to_string(variacoes, '')) <= 16000
  );

-- O corte fica numa função para ser um número só, com nome, e não um literal
-- solto no meio de um `if`.
create or replace function chat.envios_sem_resposta() returns integer
language sql immutable as $$ select 30 $$;

comment on function chat.envios_sem_resposta() is
  'Quantos envios sem nenhuma resposta bastam para a campanha se pausar.';

-- -----------------------------------------------------------------------------
-- A reserva de envio
-- -----------------------------------------------------------------------------

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
  v_enviados   integer;
  v_respostas  integer;
  v_textos     text[];
  v_body       text;
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

    -- Dezenas de envios e ninguém respondeu: a campanha para e diz por quê.
    --
    -- Lista fria tem resposta baixa, não resposta zero — e zero é o que se vê
    -- quando a plataforma já está segurando o tráfego do número, antes de
    -- remover o aparelho. Continuar daí é gastar o número para descobrir o que
    -- já dava para saber.
    --
    -- O corte é por campanha e conta do `started_at`: retomar dá uma chance
    -- nova, que é o que "retomar" quer dizer.
    select count(*) into v_enviados
      from chat.campaign_recipients cr
     where cr.campaign_id = c.id and cr.sent_at is not null;

    if v_enviados >= chat.envios_sem_resposta() then
      select count(*) into v_respostas
        from chat.messages m
        join chat.conversations cv on cv.id = m.conversation_id
        join chat.contacts ct      on ct.id = cv.contact_id
       where m.direction = 'in'
         and cv.channel_id = c.channel_id
         and m.created_at >= coalesce(c.started_at, c.created_at)
         and exists (
           select 1 from chat.campaign_recipients cr
            where cr.campaign_id = c.id and cr.wa_id = ct.wa_id
         );

      if v_respostas = 0 then
        update chat.campaigns
           set status = 'paused',
               pausa_motivo = format(
                 '%s mensagens enviadas e nenhuma resposta. A campanha parou sozinha: '
                 || 'silêncio total costuma ser a plataforma segurando o número, e foi assim '
                 || 'nas duas vezes em que este WhatsApp caiu. Confira o texto e o ritmo antes de retomar.',
                 v_enviados)
         where id = c.id;
        continue;
      end if;
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

    -- Qual das redações sai agora. Sorteada por envio, e não por campanha: o
    -- que se quer quebrar é a repetição dentro da mesma lista.
    v_textos := array_remove(array[c.body] || c.variacoes, null);
    v_body   := case
                  when cardinality(v_textos) > 1
                    then v_textos[1 + floor(random() * cardinality(v_textos))::integer]
                  else c.body
                end;

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
                c.media_kind, v_body, c.media_url, c.media_filename, c.media_mime;

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

-- -----------------------------------------------------------------------------
-- O motivo da pausa aparece na lista
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
  count(*) filter (where r.status = 'skipped')            as ignorados,
  -- Coluna nova vai no fim: `create or replace view` não aceita no meio.
  c.pausa_motivo
from chat.campaigns c
left join chat.campaign_recipients r on r.campaign_id = c.id
group by c.id;

commit;

notify pgrst, 'reload schema';
