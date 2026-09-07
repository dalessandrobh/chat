-- Posse da conversa.
--
-- Até aqui `take_over` sobrescrevia `assigned_agent_id` sem olhar quem estava
-- lá. Dois atendentes clicando "Assumir" na mesma conversa recebiam sucesso os
-- dois, e o segundo tomava a conversa em silêncio — o cliente ouvia o nome de
-- um e era respondido por outro. Nada, em lugar nenhum, impedia duas pessoas
-- de responderem o mesmo cliente ao mesmo tempo.

begin;

-- Quem perdeu a conversa também é parte da história. Sem esta coluna o evento
-- de tomada registra só quem chegou.
alter table chat.handoff_events
  add column if not exists from_agent_id uuid references chat.agents(id) on delete set null;

comment on column chat.handoff_events.from_agent_id is
  'Dono anterior da conversa, quando a troca tirou de alguém.';

-- As assinaturas mudam (ganham p_force), e deixar as duas versões conviver
-- deixaria a escolha ambígua para o PostgREST.
drop function if exists chat.take_over(uuid, text, interval);
drop function if exists chat.hand_back(uuid, text);

create function chat.take_over(
  p_conversation_id uuid,
  p_reason text default null,
  p_resume_after interval default null,
  p_force boolean default false
) returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent   uuid := auth.uid();
  v_before  chat.conversation_mode;
  v_dono    uuid;
  v_nome    text;
  v_company uuid;
  v_row     chat.conversations;
begin
  if v_agent is null then
    raise exception 'take_over exige um usuário autenticado';
  end if;

  -- O `for update` é o que torna isto exclusivo de verdade: dois cliques
  -- simultâneos viram duas execuções em fila, e a segunda já lê o dono que a
  -- primeira gravou. Sem ele, ler e escrever seriam dois momentos, e a corrida
  -- caberia inteira no meio.
  select mode, assigned_agent_id, company_id
    into v_before, v_dono, v_company
    from chat.conversations
   where id = p_conversation_id
     for update;

  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  if v_dono is not null and v_dono <> v_agent and not p_force then
    select coalesce(nullif(btrim(full_name), ''), 'outro atendente')
      into v_nome
      from chat.agents
     where id = v_dono;

    -- PT409 é a convenção do PostgREST para escolher o status HTTP. Recusa por
    -- conflito, não por erro de quem chamou.
    raise exception 'A conversa já está sendo atendida por %.', coalesce(v_nome, 'outro atendente')
      using errcode = 'PT409';
  end if;

  update chat.conversations
     set mode              = 'human',
         assigned_agent_id = v_agent,
         status            = case when status = 'closed' then 'open'::chat.conversation_status
                                  else status end,
         bot_resume_at     = case when p_resume_after is null then null
                                  else now() + p_resume_after end
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events
    (conversation_id, from_mode, to_mode, actor, agent_id, from_agent_id, reason, company_id)
  values
    (p_conversation_id, v_before, 'human', 'agent', v_agent,
     -- Reassumir a própria conversa não tirou nada de ninguém.
     nullif(v_dono, v_agent), p_reason, v_company);

  return v_row;
end;
$$;

create function chat.hand_back(
  p_conversation_id uuid,
  p_reason text default null,
  p_force boolean default false
) returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent   uuid := auth.uid();
  v_before  chat.conversation_mode;
  v_dono    uuid;
  v_nome    text;
  v_company uuid;
  v_row     chat.conversations;
begin
  select mode, assigned_agent_id, company_id
    into v_before, v_dono, v_company
    from chat.conversations
   where id = p_conversation_id
     for update;

  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Devolver ao bot é mais forte que responder: encerra o atendimento humano e
  -- despede o cliente. Se responder na conversa de outro atendente é proibido,
  -- tirá-la dele não pode ser livre. Quando não há usuário — os prazos rodam
  -- assim — a regra não se aplica: ali quem devolve é o sistema.
  if v_agent is not null and v_dono is not null and v_dono <> v_agent and not p_force then
    select coalesce(nullif(btrim(full_name), ''), 'outro atendente')
      into v_nome
      from chat.agents
     where id = v_dono;

    raise exception 'A conversa está sendo atendida por %.', coalesce(v_nome, 'outro atendente')
      using errcode = 'PT409';
  end if;

  update chat.conversations
     set mode              = 'bot',
         assigned_agent_id = null,
         bot_resume_at     = null,
         status            = case when status = 'pending' then 'open'::chat.conversation_status
                                  else status end
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events
    (conversation_id, from_mode, to_mode, actor, agent_id, from_agent_id, reason, company_id)
  values
    (p_conversation_id, v_before, 'bot', 'agent', v_agent, v_dono, p_reason, v_company);

  return v_row;
end;
$$;

-- O grant anterior vinha do padrão, que inclui PUBLIC. Quem opera o painel é
-- `authenticated`; `anon` nunca teve o que fazer aqui.
revoke all on function chat.take_over(uuid, text, interval, boolean) from public;
revoke all on function chat.hand_back(uuid, text, boolean) from public;
grant execute on function chat.take_over(uuid, text, interval, boolean) to authenticated, service_role;
grant execute on function chat.hand_back(uuid, text, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
