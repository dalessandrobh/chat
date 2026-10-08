-- A resposta pelo celular tira o cliente da fila.
--
-- `take_over_external` põe a conversa em modo humano sem dono, e o gatilho de
-- espera lê "humano sem dono" como "ninguém atendeu": o relógio da fila seguia
-- contando depois de a pessoa já ter respondido, e vencido o prazo o bot
-- mandava "ninguém da equipe conseguiu atender" por cima do atendimento.
--
-- A marca `atendida_pelo_celular_em` diz que alguém respondeu de fora do
-- painel. Com ela a conversa não conta como espera, e passa a obedecer o prazo
-- curto de inatividade, como a de um atendente que assumiu e sumiu — senão
-- ficaria em modo humano para sempre.

begin;

alter table chat.conversations
  add column if not exists atendida_pelo_celular_em timestamptz;

comment on column chat.conversations.atendida_pelo_celular_em is
  'Última resposta manual pelo WhatsApp do celular. Tira a conversa da fila; some quando ela deixa o modo humano.';

create or replace function chat.marcar_espera()
returns trigger
language plpgsql
as $$
declare
  agora_espera boolean := new.mode = 'human'
                      and new.assigned_agent_id is null
                      and new.atendida_pelo_celular_em is null
                      and new.status <> 'closed';
  antes_esperava boolean := tg_op = 'UPDATE'
                        and old.mode = 'human'
                        and old.assigned_agent_id is null
                        and old.atendida_pelo_celular_em is null
                        and old.status <> 'closed';
begin
  if new.mode <> 'human' or new.assigned_agent_id is not null then
    new.atendida_pelo_celular_em := null;
  end if;

  if agora_espera then
    new.aguardando_desde := case
      when antes_esperava then coalesce(old.aguardando_desde, now())
      else now()
    end;
  else
    new.aguardando_desde := null;
    new.atribuida_para := null;
  end if;
  return new;
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
  v_dono    uuid;
  v_row     chat.conversations;
begin
  select mode, company_id, assigned_agent_id into v_before, v_company, v_dono
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Já estava em atendimento humano: não sobrescrever o agente que assumiu
  -- pelo painel. Sem dono, a resposta pelo celular é quem atendeu.
  if v_before = 'human' then
    if v_dono is null then
      update chat.conversations set atendida_pelo_celular_em = now()
       where id = p_conversation_id;
    end if;
    select * into v_row from chat.conversations where id = p_conversation_id;
    return v_row;
  end if;

  update chat.conversations
     set mode          = 'human',
         status        = case when status = 'closed' then 'open'::chat.conversation_status
                              else status end,
         bot_resume_at = null,
         atendida_pelo_celular_em = now()
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason, company_id)
  values (p_conversation_id, v_before, 'human', 'system', p_reason, v_company);

  return v_row;
end;
$$;

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
  -- Só as que têm dono, ou que o dono respondeu pelo celular. Sem esta
  -- condição o mesmo prazo curto governava também a fila, e quem esperava
  -- atendimento voltava ao robô por causa de um número pensado para outra
  -- coisa.
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
       and (v.assigned_agent_id is not null or v.atendida_pelo_celular_em is not null)
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
