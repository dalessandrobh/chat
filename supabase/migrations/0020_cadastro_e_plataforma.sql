-- =============================================================================
-- 0020 — Cadastro de empresa e acesso de plataforma (Fase 6)
-- =============================================================================
-- Duas coisas que faltavam para o autoatendimento existir de verdade:
--
--   1. quem se cadastra hoje nasce sem empresa e não tem como criar uma —
--      enquanto existir uma empresa só o gatilho adivinha, e na segunda a
--      pessoa fica presa na tela de acesso pendente para sempre;
--   2. o dono da plataforma não enxerga nada além da própria empresa, e a
--      saída fácil — um "ou é o dono" dentro de cada política — é a que
--      transforma um engano de condição em vazamento silencioso.

-- -----------------------------------------------------------------------------
-- Criar a própria empresa
-- -----------------------------------------------------------------------------
-- Só quem ainda não tem empresa. Sem isso, qualquer pessoa logada criaria
-- empresas sem limite, e o cadastro viraria um jeito de encher o banco.

create or replace function chat.create_company(p_name text)
returns uuid
language plpgsql
security definer
-- `extensions` no caminho porque o unaccent mora lá no Supabase: sem isso a
-- função só falha na hora de criar a empresa, que é o pior momento possível.
set search_path = chat, public, extensions
as $$
declare
  v_agent   uuid := auth.uid();
  v_atual   uuid;
  v_slug    text;
  v_raiz    text;
  v_id      uuid;
  v_tenta   int := 2;
begin
  if v_agent is null then
    raise exception 'Precisa estar autenticado';
  end if;

  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Dê um nome à empresa';
  end if;

  select company_id into v_atual from chat.agents where id = v_agent;
  if not found then
    raise exception 'Conta sem cadastro no Chat';
  end if;
  if v_atual is not null then
    raise exception 'Esta conta já pertence a uma empresa'
      using errcode = 'insufficient_privilege';
  end if;

  -- Identificador estável para URL e log; não muda quando o nome muda.
  v_raiz := regexp_replace(
              lower(unaccent(btrim(p_name))),
              '[^a-z0-9]+', '-', 'g');
  v_raiz := btrim(v_raiz, '-');
  if v_raiz = '' then v_raiz := 'empresa'; end if;
  v_raiz := left(v_raiz, 40);

  v_slug := v_raiz;
  while exists (select 1 from chat.companies where slug = v_slug) loop
    v_slug := v_raiz || '-' || v_tenta;
    v_tenta := v_tenta + 1;
  end loop;

  insert into chat.companies (name, slug)
  values (btrim(p_name), v_slug)
  returning id into v_id;

  -- Quem cria é o administrador dela. Não há empresa sem administrador, e é o
  -- que o guard_last_admin protege daí em diante.
  update chat.agents
     set company_id = v_id,
         role       = 'admin',
         is_active  = true
   where id = v_agent;

  return v_id;
end;
$$;

grant execute on function chat.create_company(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Dono de plataforma
-- -----------------------------------------------------------------------------
-- Fica FORA das políticas de propósito. Nenhuma regra de acesso ganha um "ou
-- é o dono": toda porta de fuga dentro da RLS é um vazamento esperando, e o
-- erro seria invisível. O acesso amplo é superfície própria, pela chave de
-- serviço, e cada consulta deixa registro.

create table if not exists chat.platform_owners (
  agent_id   uuid primary key references chat.agents(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table chat.platform_owners is
  'Quem opera a plataforma. Não dá acesso por RLS — só habilita a tela de suporte, que é auditada.';

alter table chat.platform_owners enable row level security;
grant select on chat.platform_owners to authenticated;
grant all    on chat.platform_owners to service_role;

-- A pessoa sabe se é dona; ninguém vê a lista dos outros.
drop policy if exists platform_owners_self on chat.platform_owners;
create policy platform_owners_self on chat.platform_owners
  for select to authenticated using (agent_id = auth.uid());

create or replace function chat.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = chat, public
as $$
  select exists (
    select 1 from chat.platform_owners o
      join chat.agents a on a.id = o.agent_id
     where o.agent_id = auth.uid() and a.is_active
  );
$$;

grant execute on function chat.is_platform_owner() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- O que o suporte olhou
-- -----------------------------------------------------------------------------
-- Olhar a conta de um cliente é coisa que se audita, não que se assume.

create table if not exists chat.platform_access_log (
  id         bigserial primary key,
  actor_id   uuid references chat.agents(id) on delete set null,
  action     text not null,
  company_id uuid references chat.companies(id) on delete set null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_log_created on chat.platform_access_log (created_at desc);

alter table chat.platform_access_log enable row level security;
grant all on chat.platform_access_log to service_role;
-- Sem política para authenticated: o registro é lido pela tela de plataforma,
-- que passa pela chave de serviço depois de conferir quem está pedindo.

-- -----------------------------------------------------------------------------
-- O primeiro dono
-- -----------------------------------------------------------------------------

insert into chat.platform_owners (agent_id)
select id from chat.agents where role = 'admin' and is_active
order by created_at limit 1
on conflict (agent_id) do nothing;
-- Medida por empresa, para a tela de plataforma. Conteúdo nenhum: contagem,
-- data e estado. Ler conversa de cliente é outra decisão e precisa de outra
-- porta.
create or replace function chat.platform_overview()
returns table (
  company_id    uuid,
  name          text,
  slug          text,
  is_active     boolean,
  created_at    timestamptz,
  agentes       bigint,
  canais        bigint,
  canais_ativos bigint,
  conversas     bigint,
  mensagens_30d bigint,
  ultima_msg    timestamptz
)
language sql
security definer
set search_path = chat, public
as $$
  select c.id, c.name, c.slug, c.is_active, c.created_at,
         (select count(*) from chat.agents a        where a.company_id = c.id and a.is_active),
         (select count(*) from chat.channels ch     where ch.company_id = c.id),
         (select count(*) from chat.channels ch     where ch.company_id = c.id and ch.is_active),
         (select count(*) from chat.conversations v where v.company_id = c.id),
         (select count(*) from chat.messages m      where m.company_id = c.id
                                                      and m.created_at > now() - interval '30 days'),
         (select max(m.created_at) from chat.messages m where m.company_id = c.id)
    from chat.companies c
   order by c.created_at;
$$;

revoke all on function chat.platform_overview() from public, authenticated;
grant execute on function chat.platform_overview() to service_role;
