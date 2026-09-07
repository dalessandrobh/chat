-- Soltar a conversa sem despedir o cliente.
--
-- Quem assumia por engano, ou precisava sair, só tinha "Devolver ao bot" — que
-- despede o cliente e religa a automação. Não é a mesma coisa: o cliente pediu
-- uma pessoa, e continua querendo uma. Liberar devolve a conversa à fila,
-- calado, e o relógio da fila volta a correr para o próximo atendente.

begin;

create or replace function chat.liberar_para_fila(
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
  v_mode    chat.conversation_mode;
  v_dono    uuid;
  v_nome    text;
  v_company uuid;
  v_row     chat.conversations;
begin
  if v_agent is null then
    raise exception 'liberar_para_fila exige um usuário autenticado';
  end if;

  select mode, assigned_agent_id, company_id
    into v_mode, v_dono, v_company
    from chat.conversations
   where id = p_conversation_id
     for update;

  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Liberar é soltar de volta na fila humana. Uma conversa que está com o bot
  -- não está em fila nenhuma — mandá-la para lá seria escalar, que é outra
  -- ação, com outro aviso ao cliente.
  if v_mode <> 'human' then
    raise exception 'A conversa está com a automação, não há o que liberar'
      using errcode = 'PT409';
  end if;

  if v_dono is not null and v_dono <> v_agent and not p_force then
    select coalesce(nullif(btrim(full_name), ''), 'outro atendente')
      into v_nome
      from chat.agents
     where id = v_dono;

    raise exception 'A conversa está sendo atendida por %.', coalesce(v_nome, 'outro atendente')
      using errcode = 'PT409';
  end if;

  update chat.conversations
     set assigned_agent_id = null,
         bot_resume_at     = null,
         -- `pending` é o que quer dizer "esperando atendente", e é o que faz o
         -- gatilho da espera carimbar de novo: o relógio da fila recomeça
         -- agora, porque a espera de antes acabou quando alguém assumiu.
         status            = 'pending'
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events
    (conversation_id, from_mode, to_mode, actor, agent_id, from_agent_id, reason, company_id)
  values
    (p_conversation_id, 'human', 'human', 'agent', v_agent, v_dono, p_reason, v_company);

  return v_row;
end;
$$;

revoke all on function chat.liberar_para_fila(uuid, text, boolean) from public;
grant execute on function chat.liberar_para_fila(uuid, text, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
