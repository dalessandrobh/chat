-- =============================================================================
-- 0014 — A empresa passa a existir (Fase 1 do multiempresa)
-- =============================================================================
-- Uma pessoa pertence a uma empresa só. Essa decisão derruba a parte mais cara
-- do desenho: sem tabela de vínculo, sem papel por empresa, sem "empresa ativa
-- na sessão" e sem seletor na tela. A empresa é a do usuário logado, e ponto.
--
-- Esta migração não isola nada ainda — só cria o dono. O isolamento é a 0015
-- (coluna em cada tabela) e a 0016 (regras de acesso). As três andam juntas: a
-- metade do caminho é justamente o estado em que a separação parece pronta e
-- não está.

create table if not exists chat.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  /** Identificador estável para URL e log. Não muda quando o nome muda. */
  slug       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_companies_touch on chat.companies;
create trigger trg_companies_touch
  before update on chat.companies
  for each row execute function chat.touch_updated_at();

comment on table chat.companies is
  'Empresa atendida pelo painel. Uma pessoa pertence a uma só.';

-- Tudo que existe hoje é de uma empresa só.
insert into chat.companies (name, slug)
values ('Eco Aquecedores', 'eco-aquecedores')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- A pessoa e a empresa dela
-- -----------------------------------------------------------------------------
-- Fica NULO de propósito. Quem acabou de se cadastrar ainda não foi convidado
-- para empresa nenhuma, e o gatilho handle_new_user cria a linha antes de
-- existir convite. Nulo aqui significa "não vê nada" — que é o que se quer de
-- um desconhecido.

alter table chat.agents
  add column if not exists company_id uuid references chat.companies(id) on delete restrict;

update chat.agents
   set company_id = (select id from chat.companies where slug = 'eco-aquecedores')
 where company_id is null;

create index if not exists idx_agents_company on chat.agents (company_id);

comment on column chat.agents.company_id is
  'Empresa da pessoa. Nulo = cadastrado e ainda sem empresa: não enxerga nada.';

-- -----------------------------------------------------------------------------
-- A empresa de quem está pedindo
-- -----------------------------------------------------------------------------
-- É a peça que toda regra de acesso vai usar. Devolve NULO para quem não é
-- agente ativo, e comparação com NULO é falsa — então a política nega sozinha,
-- sem precisar de um "e existe agente" em cada uma.

create or replace function chat.current_company()
returns uuid
language sql
stable
security definer
set search_path = chat, public
as $$
  select company_id
    from chat.agents
   where id = auth.uid() and is_active;
$$;

comment on function chat.current_company is
  'Empresa do usuário logado, ou nulo. Base de todas as políticas de acesso.';

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
-- A pessoa lê a própria empresa e mais nenhuma. Renomear fica com o
-- administrador dela; criar e apagar é operação de plataforma, que ainda não
-- tem superfície — e por isso não tem política nenhuma.

alter table chat.companies enable row level security;

grant select on chat.companies to authenticated;
grant all    on chat.companies to service_role;

drop policy if exists companies_select on chat.companies;
create policy companies_select on chat.companies
  for select to authenticated
  using (id = chat.current_company());

drop policy if exists companies_update on chat.companies;
create policy companies_update on chat.companies
  for update to authenticated
  using (id = chat.current_company() and chat.is_admin())
  with check (id = chat.current_company() and chat.is_admin());

grant execute on function chat.current_company() to authenticated, service_role;
