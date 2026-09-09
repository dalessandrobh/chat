-- Bloqueio por número.
--
-- Calar o bot resolve o robô do outro lado, mas a conversa continua na lista e
-- o número continua escrevendo. Para o que ninguém quer nem ver — spam, robô
-- de prospecção, engano insistente — o bloqueio tira o número da frente de
-- todo mundo, sem apagar nada do que já foi dito.
--
-- Qualquer atendente ativo bloqueia e desbloqueia. Não é decisão de gestão: é
-- de quem está com a conversa aberta na tela às onze da noite.

begin;

-- O 9 que a operadora acrescentou não é uma diferença de número.
--
-- O WhatsApp guarda o mesmo celular como 553196546236 e 5531996546236,
-- conforme a época e o aparelho — esta base tem os dois formatos. Bloquear uma
-- forma e deixar a outra passar seria um bloqueio que não bloqueia. A chave
-- canônica é país + DDD + os oito dígitos finais.
--
-- Quem digita na tela escreve "(31) 99654-6236", sem país: dez ou onze dígitos
-- soltos ganham o 55 na frente, porque é um painel brasileiro e exigir o
-- código do país seria transformar um bloqueio em uma pegadinha. O preço é um
-- número estrangeiro de onze dígitos digitado sem o país virar brasileiro — a
-- tela mostra a chave resultante justamente para isso não passar batido.
create or replace function chat.chave_de_numero(p_numero text)
returns text
language sql
immutable
as $$
  select case
    when d ~ '^55[0-9]{10,11}$' then substring(d, 1, 4) || right(d, 8)
    when d ~ '^[0-9]{10,11}$'   then '55' || substring(d, 1, 2) || right(d, 8)
    else d
  end
  from (select regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g') as d) x;
$$;

create table if not exists chat.blocked_numbers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references chat.companies(id) on delete restrict,
  wa_id      text not null,
  chave      text generated always as (chat.chave_de_numero(wa_id)) stored,
  reason     text,
  blocked_by uuid references chat.agents(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists blocked_numbers_empresa_chave
  on chat.blocked_numbers (company_id, chave);

comment on table chat.blocked_numbers is
  'Números que não recebem resposta e não aparecem na lista. A chave ignora o 9 opcional.';

alter table chat.blocked_numbers enable row level security;

-- Bloquear é ferramenta de quem atende, não de quem administra: a regra é ser
-- agente ativo da empresa, sem distinção de papel.
drop policy if exists blocked_numbers_equipe on chat.blocked_numbers;
create policy blocked_numbers_equipe on chat.blocked_numbers
  for all to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company())
  with check (chat.is_active_agent() and company_id = chat.current_company());

grant select, insert, update, delete on chat.blocked_numbers to authenticated, service_role;

-- O estado fica materializado na conversa porque é ali que os dois webhooks e
-- a lista já olham. A lista de bloqueios é a verdade; esta coluna é a cópia
-- que o gatilho de mensagem mantém em dia.
alter table chat.conversations
  add column if not exists bloqueado_em timestamptz;

comment on column chat.conversations.bloqueado_em is
  'Cópia do bloqueio do número, mantida pelo gatilho de entrada e pelas funções de bloqueio.';

create index if not exists idx_contacts_chave
  on chat.contacts (company_id, (chat.chave_de_numero(wa_id)));

-- ---------------------------------------------------------------------------
-- Bloquear e desbloquear
-- ---------------------------------------------------------------------------

create or replace function chat.bloquear_numero(
  p_wa_id  text,
  p_reason text default null
) returns chat.blocked_numbers
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_agent   uuid := auth.uid();
  v_company uuid := chat.current_company();
  v_chave   text := chat.chave_de_numero(p_wa_id);
  v_row     chat.blocked_numbers;
begin
  if v_agent is null or v_company is null then
    raise exception 'bloquear_numero exige um atendente da empresa';
  end if;
  if v_chave = '' then
    raise exception 'Número inválido';
  end if;

  insert into chat.blocked_numbers (company_id, wa_id, reason, blocked_by)
  values (v_company, regexp_replace(p_wa_id, '[^0-9]', '', 'g'), nullif(btrim(p_reason), ''), v_agent)
  on conflict (company_id, chave) do update
    set reason     = coalesce(excluded.reason, chat.blocked_numbers.reason),
        blocked_by = excluded.blocked_by,
        created_at = now()
  returning * into v_row;

  -- A conversa sai do caminho de todo mundo: fora da fila humana, fora dos
  -- relógios de prazo, e encerrada para não voltar sozinha à lista de
  -- trabalho. Nada é apagado — desbloquear devolve o histórico inteiro.
  update chat.conversations c
     set bloqueado_em      = now(),
         mode              = 'bot',
         assigned_agent_id = null,
         bot_resume_at     = null,
         status            = 'closed'
    from chat.contacts ct
   where ct.id = c.contact_id
     and c.company_id = v_company
     and chat.chave_de_numero(ct.wa_id) = v_chave;

  return v_row;
end;
$$;

create or replace function chat.desbloquear_numero(p_wa_id text)
returns void
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid := chat.current_company();
  v_chave   text := chat.chave_de_numero(p_wa_id);
begin
  if auth.uid() is null or v_company is null then
    raise exception 'desbloquear_numero exige um atendente da empresa';
  end if;

  delete from chat.blocked_numbers
   where company_id = v_company and chave = v_chave;

  -- A conversa volta a existir para a lista, mas continua encerrada: se a
  -- pessoa escrever de novo, o gatilho de sempre reabre. Ressuscitar aqui
  -- encheria a fila com conversa que ninguém pediu de volta.
  update chat.conversations c
     set bloqueado_em = null
    from chat.contacts ct
   where ct.id = c.contact_id
     and c.company_id = v_company
     and chat.chave_de_numero(ct.wa_id) = v_chave
     and c.bloqueado_em is not null;
end;
$$;

revoke all on function chat.bloquear_numero(text, text)   from public;
revoke all on function chat.desbloquear_numero(text)      from public;
grant execute on function chat.bloquear_numero(text, text) to authenticated, service_role;
grant execute on function chat.desbloquear_numero(text)    to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O gatilho que mantém a cópia em dia
-- ---------------------------------------------------------------------------

-- Um número pode ser bloqueado antes de escrever pela primeira vez, e a
-- conversa nasce depois. Sem reconciliar na entrada, o bloqueio preventivo não
-- pegaria — e é justamente o caso de quem já sabe de quem quer distância.
create or replace function chat.silenciar_conversa_automatica()
returns trigger
language plpgsql
as $$
declare
  v_motivo    text;
  v_mode      chat.conversation_mode;
  v_ja        timestamptz;
  v_bloqueada timestamptz;
  v_company   uuid;
  v_wa_id     text;
begin
  if new.direction <> 'in' then
    return new;
  end if;

  select c.mode, c.silenciada_em, c.bloqueado_em, c.company_id, ct.wa_id
    into v_mode, v_ja, v_bloqueada, v_company, v_wa_id
    from chat.conversations c
    join chat.contacts ct on ct.id = c.contact_id
   where c.id = new.conversation_id;

  -- Primeiro o bloqueio, que é decisão de gente e vale sobre tudo.
  if exists (
    select 1 from chat.blocked_numbers b
     where b.company_id = v_company
       and b.chave = chat.chave_de_numero(v_wa_id)
  ) then
    if v_bloqueada is null then
      update chat.conversations
         set bloqueado_em = now(), mode = 'bot',
             assigned_agent_id = null, bot_resume_at = null, status = 'closed'
       where id = new.conversation_id;
    end if;
    return new;
  end if;

  if v_bloqueada is not null then
    update chat.conversations set bloqueado_em = null where id = new.conversation_id;
  end if;

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

-- ---------------------------------------------------------------------------
-- A lista deixa de mostrar o que foi bloqueado
-- ---------------------------------------------------------------------------

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
            on r.conversation_id = c.id and r.agent_id = auth.uid()
  where c.bloqueado_em is null;

-- `create or replace view` devolve as reloptions ao padrão, e sem
-- security_invoker a view passa a rodar como o dono — que é `supabase_admin`,
-- para quem a RLS não existe. A lista de uma empresa mostraria as outras.
alter view chat.inbox set (security_invoker = true);

commit;

notify pgrst, 'reload schema';
