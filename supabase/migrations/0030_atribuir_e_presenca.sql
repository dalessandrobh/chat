-- Direcionar uma conversa a um atendente, sem tirá-la da fila.
--
-- A tentação era usar `assigned_agent_id`: atribuir seria definir o dono. Mas
-- definir o dono tira a conversa da fila — zera `aguardando_desde`, some do
-- contador, desliga o prazo da fila. Atribuir a quem foi almoçar apagaria o
-- cliente de todos os lugares onde alguém o veria, em silêncio. É a mesma
-- falha que o prazo da fila acabou de corrigir, entrando por outra porta.
--
-- Então atribuir não é ter. `atribuida_para` é um recado — "esta é para o
-- Clayton" — e a conversa continua na fila, contando, visível para todos.
-- Quem assume de verdade continua sendo quem clica em Assumir.

begin;

alter table chat.conversations
  add column if not exists atribuida_para uuid references chat.agents(id) on delete set null;

comment on column chat.conversations.atribuida_para is
  'Atendente a quem a conversa foi direcionada. Recado, não posse: ela segue na fila.';

alter table chat.handoff_events
  add column if not exists para_agent_id uuid references chat.agents(id) on delete set null;

comment on column chat.handoff_events.para_agent_id is
  'Quem recebeu o direcionamento. `agent_id` continua sendo quem agiu.';

-- O recado é da fila. Saiu da fila — alguém assumiu, voltou ao bot, foi
-- encerrada — o recado perde o sentido junto.
create or replace function chat.marcar_espera()
returns trigger
language plpgsql
as $$
declare
  agora_espera boolean := new.mode = 'human'
                      and new.assigned_agent_id is null
                      and new.status <> 'closed';
  antes_esperava boolean := tg_op = 'UPDATE'
                        and old.mode = 'human'
                        and old.assigned_agent_id is null
                        and old.status <> 'closed';
begin
  if agora_espera then
    -- Continuar esperando não reinicia o relógio: uma mensagem nova do cliente
    -- não apaga os vinte minutos que ele já esperou.
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

create or replace function chat.atribuir_conversa(
  p_conversation_id uuid,
  p_agent_id uuid,
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
    raise exception 'atribuir_conversa exige um usuário autenticado';
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

  if v_mode <> 'human' then
    raise exception 'A conversa está com a automação. Escale antes de direcionar.'
      using errcode = 'PT409';
  end if;

  -- Direcionar para fora da empresa seria vazamento com outro nome. Inativo
  -- também não serve: é justamente quem não vai aparecer.
  if p_agent_id is not null and not exists (
    select 1 from chat.agents
     where id = p_agent_id and company_id = v_company and is_active
  ) then
    raise exception 'Atendente % não está ativo nesta empresa', p_agent_id;
  end if;

  if v_dono is not null and v_dono <> v_agent and not p_force then
    select coalesce(nullif(btrim(full_name), ''), 'outro atendente')
      into v_nome
      from chat.agents
     where id = v_dono;

    raise exception 'A conversa está sendo atendida por %.', coalesce(v_nome, 'outro atendente')
      using errcode = 'PT409';
  end if;

  -- Atribuir devolve a conversa à fila com o recado. Quem estava atendendo
  -- deixa de ser dono: passar adiante é sair, e continuar como dono faria a
  -- trava de envio recusar o próprio destinatário.
  update chat.conversations
     set assigned_agent_id = null,
         bot_resume_at     = null,
         status            = 'pending',
         atribuida_para    = p_agent_id
   where id = p_conversation_id
   returning * into v_row;

  insert into chat.handoff_events
    (conversation_id, from_mode, to_mode, actor, agent_id, from_agent_id, para_agent_id, reason, company_id)
  values
    (p_conversation_id, 'human', 'human', 'agent', v_agent, v_dono, p_agent_id,
     coalesce(p_reason, case when p_agent_id is null then 'Direcionamento removido'
                             else 'Direcionada a um atendente' end),
     v_company);

  return v_row;
end;
$$;

revoke all on function chat.atribuir_conversa(uuid, uuid, text, boolean) from public;
grant execute on function chat.atribuir_conversa(uuid, uuid, text, boolean) to authenticated, service_role;

create or replace view chat.inbox as
 select c.id as conversation_id,
    c.channel_id,
    c.status,
    c.mode,
    c.assigned_agent_id,
    a.full_name as assigned_agent_name,
    c.unread_count,
    c.last_message_at,
    c.last_message_preview,
    c.window_expires_at,
        case
            when ch.provider = 'evolution'::text then true
            else c.window_expires_at > now()
        end as within_window,
    c.bot_resume_at,
    ct.id as contact_id,
    ct.wa_id,
    coalesce(ct.display_name, ct.profile_name, ct.wa_id) as contact_name,
    ct.tags,
    ch.name as channel_name,
    ch.display_phone_number,
    ch.provider,
    c.aguardando_desde,
    c.atribuida_para,
    b.full_name as atribuida_para_nome
   from chat.conversations c
     join chat.contacts ct on ct.id = c.contact_id
     join chat.channels ch on ch.id = c.channel_id
     left join chat.agents a on a.id = c.assigned_agent_id
     left join chat.agents b on b.id = c.atribuida_para;

-- `create or replace view` devolve as reloptions ao padrão, e sem
-- security_invoker a view passa a rodar como o dono — que é `supabase_admin`,
-- para quem a RLS não existe. A lista de uma empresa mostraria as outras.
alter view chat.inbox set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Presença: quem está com o painel aberto.
--
-- O canal é privado, e privado no Realtime quer dizer "autorizado pela RLS de
-- realtime.messages". Sem política, a tabela nega tudo — que é o padrão desta
-- instalação. Com ela, cada empresa só entra no canal do próprio id, e saber
-- quem está online deixa de ser assunto compartilhado com as outras.
-- ---------------------------------------------------------------------------

drop policy if exists "presenca_da_propria_empresa_le"    on realtime.messages;
drop policy if exists "presenca_da_propria_empresa_envia" on realtime.messages;

create policy "presenca_da_propria_empresa_le"
  on realtime.messages for select to authenticated
  using (
    chat.is_active_agent()
    and realtime.topic() = 'presenca:' || chat.current_company()::text
  );

create policy "presenca_da_propria_empresa_envia"
  on realtime.messages for insert to authenticated
  with check (
    chat.is_active_agent()
    and realtime.topic() = 'presenca:' || chat.current_company()::text
  );

commit;

notify pgrst, 'reload schema';
