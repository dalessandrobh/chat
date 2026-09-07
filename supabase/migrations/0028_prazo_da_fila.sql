-- Dois relógios, não um.
--
-- `devolver_ao_bot_minutos` valia para qualquer conversa em modo humano, com
-- dono ou sem. São duas situações que não se parecem: o atendente assumiu e
-- sumiu no meio, e ninguém pegou a conversa até agora. A primeira quer um
-- prazo curto — a conversa está presa numa pessoa que saiu. A segunda quer um
-- prazo longo, porque encurtá-lo é tirar da fila o cliente que pediu ajuda: a
-- equipe ocupada por meia hora perdia o cliente para o bot sem ninguém ver.

begin;

-- O espelho de `proxima_abertura`: a última vez que a empresa abriu, olhando
-- para trás.
--
-- É o que impede o prazo da fila de vencer no primeiro minuto do expediente.
-- `aguardando_desde` conta em tempo de relógio, então a conversa que escalou
-- às 22h chega às 8h da manhã com dez horas de espera e seria devolvida na
-- hora — justamente a conversa que o aviso de fora do expediente prometeu que
-- alguém atenderia pela manhã.
create or replace function chat.ultima_abertura(
  p_company_id uuid,
  p_quando timestamptz default now()
) returns timestamptz
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  cfg    jsonb;
  tz     text;
  local  timestamp;
  d      int;
  dia    date;
  faixa  jsonb;
  quando timestamptz;
begin
  select p.horario_semana, p.fuso into cfg, tz
    from chat.company_profile p
   where p.company_id = p_company_id;

  -- Sem grade configurada a empresa é aberta 24 horas, e não há abertura: o
  -- relógio da fila conta desde que a conversa entrou nela.
  if cfg is null or cfg = '{}'::jsonb then
    return null;
  end if;

  tz := coalesce(nullif(btrim(tz), ''), 'America/Sao_Paulo');
  local := p_quando at time zone tz;

  for d in 0..7 loop
    dia   := (local - make_interval(days => d))::date;
    faixa := cfg -> extract(dow from dia)::int::text;

    if faixa is not null then
      quando := (dia + (faixa->>'abre')::time) at time zone tz;
      if quando <= p_quando then
        return quando;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function chat.ultima_abertura(uuid, timestamptz) from public, authenticated;
grant execute on function chat.ultima_abertura(uuid, timestamptz) to service_role;

create or replace function chat.aplicar_prazos_de_conversa()
returns table(conversa_id uuid, empresa_id uuid, empresa text, acao text)
language plpgsql
security definer
set search_path = chat, public
as $$
begin
  return query
  with prazos as (
    select c.id as empresa_id,
           c.name as empresa_nome,
           nullif((d.value #>> '{}')::int, 0) as devolver_min,
           nullif((f.value #>> '{}')::int, 0) as fila_min,
           nullif((e.value #>> '{}')::int, 0) as encerrar_min,
           -- O relógio é de expediente. Uma conversa que escalou às 22h não
           -- pode ser devolvida ao bot às 22h30: ela foi para a fila humana
           -- justamente porque a equipe só chega de manhã, e devolver
           -- apagaria o `pending` que é o recado deixado para amanhã.
           chat.empresa_aberta(c.id) as aberta,
           chat.ultima_abertura(c.id) as abertura
      from chat.companies c
      left join chat.settings d
        on d.company_id = c.id and d.key = 'devolver_ao_bot_minutos'
      left join chat.settings f
        on f.company_id = c.id and f.key = 'devolver_da_fila_minutos'
      left join chat.settings e
        on e.company_id = c.id and e.key = 'encerrar_apos_minutos'
     where c.is_active
  ),

  -- 1. O atendente assumiu e sumiu: a conversa volta para o bot.
  --
  -- Só as que têm dono. Sem esta condição o mesmo prazo curto governava
  -- também a fila, e quem esperava atendimento voltava ao robô por causa de
  -- um número pensado para outra coisa.
  devolvidas as (
    update chat.conversations v
       set mode              = 'bot',
           assigned_agent_id = null,
           bot_resume_at     = null,
           status            = case when v.status = 'pending' then 'open'::chat.conversation_status
                                    else v.status end
      from prazos p
     where v.company_id = p.empresa_id
       and p.aberta
       and p.devolver_min is not null
       and v.mode = 'human'
       and v.assigned_agent_id is not null
       and v.status <> 'closed'
       and coalesce(v.last_message_at, v.updated_at)
             < now() - make_interval(mins => p.devolver_min)
    returning v.id, v.company_id, p.empresa_nome
  ),
  registro_devolucao as (
    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason, company_id)
    select d.id, 'human', 'bot', 'system', 'Devolvida por inatividade', d.company_id from devolvidas d
    returning 1
  ),

  -- 2. Ninguém pegou a conversa da fila dentro do prazo.
  --
  -- O relógio conta a partir da abertura mais recente, e não de quando a
  -- conversa entrou na fila: a espera da madrugada não é espera de
  -- atendimento. E o prazo é de espera, não de silêncio — o cliente que
  -- manda três mensagens enquanto aguarda continua aguardando.
  fila as (
    update chat.conversations v
       set mode              = 'bot',
           assigned_agent_id = null,
           bot_resume_at     = null,
           status            = case when v.status = 'pending' then 'open'::chat.conversation_status
                                    else v.status end
      from prazos p
     where v.company_id = p.empresa_id
       and p.aberta
       and p.fila_min is not null
       and v.aguardando_desde is not null
       and v.status <> 'closed'
       and greatest(v.aguardando_desde, coalesce(p.abertura, v.aguardando_desde))
             < now() - make_interval(mins => p.fila_min)
       -- Uma conversa que já vai ser arquivada neste mesmo passo não precisa
       -- ouvir "não consegui falar com a equipe" antes de sumir da lista.
       and (p.encerrar_min is null
            or coalesce(v.last_message_at, v.updated_at)
                 >= now() - make_interval(mins => p.encerrar_min))
    returning v.id, v.company_id, p.empresa_nome
  ),
  registro_fila as (
    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason, company_id)
    select f.id, 'human', 'bot', 'system', 'Ninguém assumiu dentro do prazo', f.company_id from fila f
    returning 1
  ),

  -- 3. Conversa parada há mais tempo ainda é arquivada.
  --
  -- Volta para o bot junto, mesmo que o prazo de devolução não tenha corrido:
  -- fechar uma conversa em modo humano deixaria uma armadilha — o contato
  -- escreve, o gatilho reabre, e o bot continua calado porque o modo é
  -- `human`. Ninguém responderia, e nada apareceria como erro.
  encerradas as (
    update chat.conversations v
       set status            = 'closed',
           mode              = 'bot',
           assigned_agent_id = null,
           bot_resume_at     = null
      from prazos p
     where v.company_id = p.empresa_id
       and p.aberta
       and p.encerrar_min is not null
       and v.status <> 'closed'
       and coalesce(v.last_message_at, v.updated_at)
             < now() - make_interval(mins => p.encerrar_min)
    returning v.id, v.company_id, p.empresa_nome
  )

  select d.id, d.company_id, d.empresa_nome, 'devolvida'::text from devolvidas d
  union all
  select f.id, f.company_id, f.empresa_nome, 'fila_expirada'::text from fila f
  union all
  select e.id, e.company_id, e.empresa_nome, 'encerrada'::text from encerradas e;
end;
$$;

commit;

notify pgrst, 'reload schema';
