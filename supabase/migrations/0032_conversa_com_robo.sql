-- Dois robôs conversando não param sozinhos.
--
-- Um atendimento automático de outra empresa entrou no número da Eco. O padrão
-- dele: "Esse atendimento foi encerrado, mande uma nova mensagem" → o nosso bot
-- responde → "Aguarde, estamos transferindo" → "Seu protocolo é 28974" → "Esse
-- atendimento foi encerrado" → o nosso bot responde de novo. Dez protocolos em
-- quinze minutos, cada volta com uma chamada de modelo e uma mensagem paga.
--
-- Ninguém do outro lado vai desistir: não há ninguém do outro lado.

begin;

alter table chat.conversations
  add column if not exists silenciada_em     timestamptz,
  add column if not exists silenciada_motivo text,
  add column if not exists bot_reativado_em  timestamptz;

comment on column chat.conversations.silenciada_em is
  'Quando o bot parou de responder por ter reconhecido outro robô do outro lado.';
comment on column chat.conversations.bot_reativado_em is
  'Marco d''água: a detecção só olha o que veio depois de alguém reativar o bot.';

-- O que denuncia a máquina é a repetição literal, não o assunto.
--
-- Gente repete "oi" e repete a mesma pergunta — nos dados desta base, no
-- máximo duas vezes. Robô repete a mesma frase inteira, com o número do
-- protocolo como única diferença, e responde em segundos a qualquer hora. Por
-- isso o texto é normalizado sem dígitos: "protocolo 28974" e "protocolo
-- 28975" são a mesma frase dita duas vezes.
--
-- As três condições andam juntas de propósito. Repetição sozinha pega quem
-- mandou "bom dia" três vezes; pressa sozinha pega quem digita rápido. Só as
-- três juntas descrevem algo que não vai parar por conta própria.
create or replace function chat.conversa_automatica(p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = chat, public
as $$
  with marco as (
    select coalesce(c.bot_reativado_em, '-infinity'::timestamptz) as desde
      from chat.conversations c where c.id = p_conversation_id
  ),
  entradas as (
    select btrim(regexp_replace(
             regexp_replace(lower(coalesce(m.body, '')), '[^a-záàâãéêíóôõúüç]+', ' ', 'g'),
             ' +', ' ', 'g')) as texto,
           row_number() over (order by m.created_at desc) as pos,
           count(*) over () as total
      from chat.messages m, marco
     where m.conversation_id = p_conversation_id
       and m.direction = 'in'
       and m.created_at > marco.desde
  ),
  repeticoes as (
    select coalesce(max(n), 0) as maior
      from (select count(*) as n
              from entradas where pos <= 12 and texto <> ''
             group by texto) x
  ),
  rapidas as (
    select count(*) as n
      from chat.messages e, marco
     where e.conversation_id = p_conversation_id
       and e.direction = 'in'
       and e.created_at > marco.desde
       and exists (
         select 1 from chat.messages s
          where s.conversation_id = p_conversation_id
            and s.direction = 'out'
            and s.created_at < e.created_at
            and e.created_at - s.created_at <= interval '90 seconds')
  ),
  desenfreada as (
    select count(*) as n
      from chat.messages o
     where o.conversation_id = p_conversation_id
       and o.direction = 'out' and o.author = 'bot'
       and o.created_at > now() - interval '1 hour'
  )
  select case
    when coalesce((select max(total) from entradas), 0) >= 6
     and (select maior from repeticoes) >= 3
     and (select n from rapidas) >= 3
      then 'Repetiu ' || (select maior from repeticoes)
           || ' vezes a mesma mensagem e respondeu em segundos: do outro lado há um atendimento automático.'
    -- Rede de segurança para o laço que a repetição não reconhecer: seja lá o
    -- que esteja acontecendo, vinte respostas numa hora não é atendimento.
    when (select n from desenfreada) >= 20
      then 'O bot respondeu 20 vezes na última hora sem a conversa sair do lugar.'
    else null
  end;
$$;

revoke all on function chat.conversa_automatica(uuid) from public, authenticated;
grant execute on function chat.conversa_automatica(uuid) to service_role;

create or replace function chat.silenciar_conversa_automatica()
returns trigger
language plpgsql
as $$
declare
  v_motivo text;
  v_mode   chat.conversation_mode;
  v_ja     timestamptz;
begin
  if new.direction <> 'in' then
    return new;
  end if;

  select mode, silenciada_em into v_mode, v_ja
    from chat.conversations where id = new.conversation_id;

  -- Já calada, ou já nas mãos de uma pessoa: não há robô solto para conter.
  if v_ja is not null or v_mode <> 'bot' then
    return new;
  end if;

  v_motivo := chat.conversa_automatica(new.conversation_id);
  if v_motivo is null then
    return new;
  end if;

  -- Calar é tudo o que se faz. Mandar "percebi que você é um robô, tchau"
  -- seria mais uma mensagem no laço, e o laço aceita qualquer uma.
  update chat.conversations
     set silenciada_em = now(), silenciada_motivo = v_motivo
   where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists trg_messages_silencia_automatica on chat.messages;
create trigger trg_messages_silencia_automatica
  after insert on chat.messages
  for each row execute function chat.silenciar_conversa_automatica();

-- Quem olhar e discordar reativa. O marco d'água impede que a detecção
-- reconheça de novo a mesma repetição de antes e cale outra vez no mesmo
-- segundo — reativar tem de dar ao bot uma chance de verdade.
create or replace function chat.reativar_bot(p_conversation_id uuid)
returns chat.conversations
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
  v_row     chat.conversations;
begin
  select company_id into v_company
    from chat.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'Conversa % não encontrada', p_conversation_id;
  end if;

  perform chat.assert_same_company(v_company);

  update chat.conversations
     set silenciada_em = null, silenciada_motivo = null, bot_reativado_em = now()
   where id = p_conversation_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function chat.reativar_bot(uuid) from public;
grant execute on function chat.reativar_bot(uuid) to authenticated, service_role;

-- As que já estão em laço não esperam a próxima mensagem para parar.
update chat.conversations c
   set silenciada_em = now(),
       silenciada_motivo = chat.conversa_automatica(c.id)
 where c.mode = 'bot'
   and c.silenciada_em is null
   and chat.conversa_automatica(c.id) is not null;

create or replace view chat.inbox as
 select c.id as conversation_id,
    c.channel_id,
    c.status,
    c.mode,
    c.assigned_agent_id,
    a.full_name as assigned_agent_name,
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
    b.full_name as atribuida_para_nome,
    c.silenciada_em,
    c.silenciada_motivo
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

commit;

notify pgrst, 'reload schema';
