-- =============================================================================
-- 0021 — Prazos: devolver ao bot e encerrar por inatividade
-- =============================================================================
-- Duas peças que faltavam, e uma que existia sem nunca ter sido ligada.
--
-- `chat.auto_hand_back_expired()` está no projeto desde a Fase 1 e nenhuma
-- linha de código a chama. Ela depende de `bot_resume_at`, que é preenchido
-- só quando alguém assume a conversa pedindo prazo — e o painel nunca pediu.
-- Resultado: o campo está nulo nas onze conversas e a função nunca rodou.
--
-- O desenho aqui é outro: o prazo não é de cada conversa, é da empresa, e
-- vale para toda conversa parada. Assim uma escalação que ninguém atendeu
-- volta sozinha, em vez de ficar três dias em `pending` — que é exatamente o
-- que está acontecendo hoje.
--
-- Encerrar é arquivar. O gatilho de sincronização reabre a conversa quando o
-- contato volta a escrever, então nada aqui é definitivo e nada disso é
-- visível para o cliente.

-- -----------------------------------------------------------------------------
-- Padrões
-- -----------------------------------------------------------------------------
-- Nascem desligados de propósito: ligar um relógio que mexe em conversa de
-- cliente sem alguém ter pedido é pior do que não ter o relógio.

comment on table chat.settings is
  'Ajustes por empresa. Ausência de linha significa o padrão do ajuste, não "desligado".';

-- -----------------------------------------------------------------------------
-- O relógio
-- -----------------------------------------------------------------------------

create or replace function chat.aplicar_prazos_de_conversa()
-- Os nomes de saída não repetem nomes de coluna: dentro da função eles viram
-- variáveis, e `company_id` sozinho ficaria ambíguo no INSERT lá embaixo.
returns table (
  conversa_id uuid,
  empresa_id  uuid,
  empresa     text,
  acao        text
)
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
           nullif((e.value #>> '{}')::int, 0) as encerrar_min
      from chat.companies c
      left join chat.settings d
        on d.company_id = c.id and d.key = 'devolver_ao_bot_minutos'
      left join chat.settings e
        on e.company_id = c.id and e.key = 'encerrar_apos_minutos'
     where c.is_active
  ),

  -- 1. Conversa parada em atendimento humano volta para o bot.
  devolvidas as (
    update chat.conversations v
       set mode              = 'bot',
           assigned_agent_id = null,
           bot_resume_at     = null,
           -- `pending` quer dizer "esperando atendente". Devolvida ao bot, não
           -- está mais esperando ninguém — deixar assim faria a conversa
           -- seguir marcada como fila na tela, sem estar.
           status            = case when v.status = 'pending' then 'open'::chat.conversation_status
                                    else v.status end
      from prazos p
     where v.company_id = p.empresa_id
       and p.devolver_min is not null
       and v.mode = 'human'
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

  -- 2. Conversa parada há mais tempo ainda é arquivada.
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
       and p.encerrar_min is not null
       and v.status <> 'closed'
       and coalesce(v.last_message_at, v.updated_at)
             < now() - make_interval(mins => p.encerrar_min)
    returning v.id, v.company_id, p.empresa_nome
  )

  select d.id, d.company_id, d.empresa_nome, 'devolvida'::text from devolvidas d
  union all
  select e.id, e.company_id, e.empresa_nome, 'encerrada'::text from encerradas e;
end;
$$;

comment on function chat.aplicar_prazos_de_conversa is
  'Aplica os prazos de cada empresa. Devolve o que mudou para quem chamou avisar o cliente.';

revoke all on function chat.aplicar_prazos_de_conversa() from public, authenticated;
grant execute on function chat.aplicar_prazos_de_conversa() to service_role;

-- -----------------------------------------------------------------------------
-- Encerrar e reabrir pela tela
-- -----------------------------------------------------------------------------

create or replace function chat.close_conversation(p_conversation_id uuid)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
  v_mode    chat.conversation_mode;
  v_row     chat.conversations;
begin
  select company_id, mode into v_company, v_mode
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Mesmo cuidado do encerramento automático: sair de `human` junto, senão a
  -- conversa reabre muda.
  update chat.conversations
     set status            = 'closed',
         mode              = 'bot',
         assigned_agent_id = null,
         bot_resume_at     = null,
         unread_count      = 0
   where id = p_conversation_id
   returning * into v_row;

  if v_mode = 'human' then
    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason, company_id)
    values (p_conversation_id, 'human', 'bot', 'agent', auth.uid(), 'Conversa encerrada no painel', v_company);
  end if;

  return v_row;
end;
$$;

create or replace function chat.reopen_conversation(p_conversation_id uuid)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
  v_row     chat.conversations;
begin
  select company_id into v_company from chat.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  update chat.conversations set status = 'open'
   where id = p_conversation_id
   returning * into v_row;

  return v_row;
end;
$$;

grant execute on function chat.close_conversation(uuid)  to authenticated, service_role;
grant execute on function chat.reopen_conversation(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- A devolução manual tinha o mesmo defeito
-- -----------------------------------------------------------------------------
-- `hand_back` voltava o modo para bot e deixava o status em `pending`: a
-- conversa continuava marcada como fila humana na tela, sem estar em fila
-- nenhuma.

create or replace function chat.hand_back(p_conversation_id uuid, p_reason text default null)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent   uuid := auth.uid();
  v_before  chat.conversation_mode;
  v_company uuid;
  v_row     chat.conversations;
begin
  select mode, company_id into v_before, v_company
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  update chat.conversations
     set mode              = 'bot',
         assigned_agent_id = null,
         bot_resume_at     = null,
         status            = case when status = 'pending' then 'open'::chat.conversation_status
                                  else status end
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason, company_id)
  values (p_conversation_id, v_before, 'bot', 'agent', v_agent, p_reason, v_company);

  return v_row;
end;
$$;
