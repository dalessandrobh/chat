-- Há quanto tempo o cliente espera.
--
-- A lista mostrava o tempo desde a última mensagem, que é outra coisa: quem
-- pediu um atendente e ficou calado afundava abaixo de quem acabou de escrever
-- para o bot. Sem o instante em que a conversa entrou na fila não dá para
-- ordenar por antiguidade nem dizer "esperando há 12 minutos".

begin;

alter table chat.conversations
  add column if not exists aguardando_desde timestamptz;

comment on column chat.conversations.aguardando_desde is
  'Quando entrou na fila humana sem dono. Nulo quando não está esperando.';

-- Esperar é um estado derivado de outros três, e derivado é fácil de deixar
-- desatualizado. O gatilho é o que garante que qualquer caminho — a escalada
-- do bot, o prazo que devolve, o atendente que solta — deixe o carimbo certo,
-- inclusive um `update` feito na mão pelo Studio.
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
  end if;
  return new;
end;
$$;

drop trigger if exists trg_conversations_espera on chat.conversations;
create trigger trg_conversations_espera
  before insert or update on chat.conversations
  for each row execute function chat.marcar_espera();

-- As que já estão na fila entraram antes do gatilho existir. O instante certo
-- é o do handoff que as colocou lá; quando não há registro, sobra o
-- `updated_at`, que erra para menos e nunca inventa uma espera maior do que a
-- real.
alter table chat.conversations disable trigger trg_conversations_espera;

update chat.conversations c
   set aguardando_desde = coalesce(
         (select max(h.created_at)
            from chat.handoff_events h
           where h.conversation_id = c.id
             and h.to_mode = 'human'),
         c.updated_at)
 where c.mode = 'human'
   and c.assigned_agent_id is null
   and c.status <> 'closed'
   and c.aguardando_desde is null;

alter table chat.conversations enable trigger trg_conversations_espera;

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
    c.aguardando_desde
   from chat.conversations c
     join chat.contacts ct on ct.id = c.contact_id
     join chat.channels ch on ch.id = c.channel_id
     left join chat.agents a on a.id = c.assigned_agent_id;

-- `create or replace view` devolve as reloptions ao padrão, e sem
-- security_invoker a view passa a rodar como o dono — que é `supabase_admin`,
-- para quem a RLS não existe. A lista de uma empresa mostraria as outras.
alter view chat.inbox set (security_invoker = true);

commit;

notify pgrst, 'reload schema';
