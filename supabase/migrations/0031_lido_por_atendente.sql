-- Não lidas de quem está olhando, não da conversa.
--
-- `conversations.unread_count` era um número só: o primeiro que abria a
-- conversa zerava o contador de todo mundo. Numa equipe isso não é um detalhe
-- — é a lista dizendo "já viram isso" quando ninguém viu.
--
-- O que se guarda agora não é um contador, é até onde cada um leu. Contador
-- exigiria somar em toda mensagem, para todo agente, e um agente novo nasceria
-- com o número errado. `lido_ate` é um instante: comparado com as mensagens de
-- entrada, dá o número certo para qualquer pessoa, inclusive quem chegou hoje.

begin;

create table if not exists chat.conversation_reads (
  conversation_id uuid not null references chat.conversations(id) on delete cascade,
  agent_id        uuid not null references chat.agents(id)        on delete cascade,
  lido_ate        timestamptz not null default now(),
  company_id      uuid not null references chat.companies(id)     on delete restrict,
  primary key (conversation_id, agent_id)
);

comment on table chat.conversation_reads is
  'Até onde cada atendente leu cada conversa. A ausência de linha não é "nada lido": veja a view inbox.';

alter table chat.conversation_reads enable row level security;

-- Leitura é assunto de quem leu. Nem faria sentido um agente escrever a marca
-- de outro: o efeito visível seria a conversa sumir da lista de alguém que
-- nunca a abriu.
drop policy if exists conversation_reads_propria on chat.conversation_reads;
create policy conversation_reads_propria on chat.conversation_reads
  for all to authenticated
  using (agent_id = auth.uid() and company_id = chat.current_company())
  with check (agent_id = auth.uid() and company_id = chat.current_company());

grant select, insert, update, delete on chat.conversation_reads to authenticated, service_role;

-- As conversas que já existem foram lidas por alguém — marcá-las como não
-- lidas para todos na virada seria estrear o recurso mentindo.
insert into chat.conversation_reads (conversation_id, agent_id, lido_ate, company_id)
select c.id, a.id, now(), c.company_id
  from chat.conversations c
  join chat.agents a on a.company_id = c.company_id and a.is_active
on conflict (conversation_id, agent_id) do nothing;

create or replace function chat.mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
  v_agent   uuid := auth.uid();
begin
  select company_id into v_company from chat.conversations where id = p_conversation_id;
  if not found then
    return;
  end if;

  perform chat.assert_same_company(v_company);

  -- Sem usuário não há quem tenha lido. O servidor abrir uma conversa não é
  -- alguém tê-la lido, e inventar um leitor apagaria o aviso de uma pessoa.
  if v_agent is null then
    return;
  end if;

  insert into chat.conversation_reads (conversation_id, agent_id, lido_ate, company_id)
  values (p_conversation_id, v_agent, now(), v_company)
  on conflict (conversation_id, agent_id) do update set lido_ate = excluded.lido_ate;
end;
$$;

-- O dono respondeu pelo celular: quem quer que abra o painel depois não
-- precisa ver aquilo como pendente. É o único caso em que a leitura é de
-- todos, porque a resposta veio de fora do painel e não dá para saber de quem.
create or replace function chat.marcar_lida_para_todos(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from chat.conversations where id = p_conversation_id;
  if not found then
    return;
  end if;

  perform chat.assert_same_company(v_company);

  insert into chat.conversation_reads (conversation_id, agent_id, lido_ate, company_id)
  select p_conversation_id, a.id, now(), v_company
    from chat.agents a
   where a.company_id = v_company and a.is_active
  on conflict (conversation_id, agent_id) do update set lido_ate = excluded.lido_ate;
end;
$$;

revoke all on function chat.marcar_lida_para_todos(uuid) from public, authenticated;
grant execute on function chat.marcar_lida_para_todos(uuid) to service_role;

-- O gatilho para de somar um contador que ninguém mais lê.
create or replace function chat.sync_conversation_on_message()
returns trigger
language plpgsql
as $$
declare
  v_preview text;
begin
  -- Preview curto para a lista do inbox
  v_preview := left(
    coalesce(
      nullif(new.body, ''),
      case new.type
        when 'image'    then '📷 Imagem'
        when 'audio'    then '🎤 Áudio'
        when 'video'    then '🎬 Vídeo'
        when 'document' then '📎 Documento'
        when 'sticker'  then '🙂 Figurinha'
        when 'location' then '📍 Localização'
        when 'contacts' then '👤 Contato'
        when 'template' then '📋 Template'
        else new.type
      end
    ), 200);

  if new.direction = 'in' then
    update chat.conversations c
       set last_inbound_at    = new.created_at,
           last_message_at    = new.created_at,
           -- A janela de atendimento da Meta reabre a cada mensagem do contato
           window_expires_at  = new.created_at + interval '24 hours',
           last_message_preview = v_preview,
           -- Uma conversa fechada reabre sozinha quando o contato volta a falar
           status = case when c.status = 'closed' then 'open'::chat.conversation_status
                         else c.status end
     where c.id = new.conversation_id;

  else
    update chat.conversations c
       set last_outbound_at = new.created_at,
           last_message_at  = new.created_at,
           last_message_preview = v_preview
     where c.id = new.conversation_id;
  end if;

  return new;
end;
$$;

create or replace view chat.inbox as
 select c.id as conversation_id,
    c.channel_id,
    c.status,
    c.mode,
    c.assigned_agent_id,
    a.full_name as assigned_agent_name,
    -- Não lidas de quem está perguntando. Sem linha em conversation_reads o
    -- piso é a entrada do agente na empresa: ninguém deve as mensagens que
    -- chegaram antes de existir por aqui.
    (select count(*)
       from chat.messages m
      where m.conversation_id = c.id
        and m.direction = 'in'
        and m.created_at > coalesce(r.lido_ate, eu.created_at, '-infinity'::timestamptz)
    )::int as unread_count,
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
     left join chat.agents b on b.id = c.atribuida_para
     left join chat.agents eu on eu.id = auth.uid()
     left join chat.conversation_reads r
            on r.conversation_id = c.id and r.agent_id = auth.uid();

-- `create or replace view` devolve as reloptions ao padrão, e sem
-- security_invoker a view passa a rodar como o dono — que é `supabase_admin`,
-- para quem a RLS não existe. A lista de uma empresa mostraria as outras.
alter view chat.inbox set (security_invoker = true);

-- Encerrar zerava o contador junto. Continua fazendo o equivalente, agora para
-- a equipe: arquivar é dizer "isto está resolvido", e deixar o aviso de não
-- lida para quem nunca abriu faria a conversa voltar da gaveta pedindo
-- atenção que ninguém mais deve.
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
         bot_resume_at     = null
   where id = p_conversation_id
   returning * into v_row;

  perform chat.marcar_lida_para_todos(p_conversation_id);

  if v_mode = 'human' then
    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, agent_id, reason, company_id)
    values (p_conversation_id, 'human', 'bot', 'agent', auth.uid(), 'Conversa encerrada no painel', v_company);
  end if;

  return v_row;
end;
$$;

alter table chat.conversations drop column if exists unread_count;

commit;

notify pgrst, 'reload schema';
