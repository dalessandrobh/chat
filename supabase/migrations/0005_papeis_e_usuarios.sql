-- =============================================================================
-- 0005 — Três papéis e gestão de usuários pelo painel
-- =============================================================================
-- O enum nasceu com quatro papéis herdados de um rascunho ('owner', 'admin',
-- 'agent', 'viewer'). Na prática só três importam, e são estes:
--
--   admin    Administrador — manda em tudo, inclusive em quem entra.
--   manager  Gestor        — cuida do atendimento e dos templates, não de gente.
--   agent    Usuário       — atende conversas.
--
-- 'owner' vira 'admin' e 'viewer' vira 'agent'.

-- -----------------------------------------------------------------------------
-- ENUM
-- -----------------------------------------------------------------------------
-- Postgres não remove valor de enum: o caminho é criar o tipo novo e migrar a
-- coluna. O default sai antes porque ele depende do tipo antigo.

alter type chat.agent_role rename to agent_role_legado;

create type chat.agent_role as enum ('admin', 'manager', 'agent');

alter table chat.agents alter column role drop default;

alter table chat.agents
  alter column role type chat.agent_role
  using (
    case role::text
      when 'owner'  then 'admin'
      when 'viewer' then 'agent'
      else role::text
    end
  )::chat.agent_role;

alter table chat.agents alter column role set default 'agent';

drop type chat.agent_role_legado;

comment on column chat.agents.role is
  'admin = gerencia usuários e canais; manager = gerencia templates e '
  'atendimento; agent = atende conversas.';

-- -----------------------------------------------------------------------------
-- PREDICADOS DE PERMISSÃO
-- -----------------------------------------------------------------------------

create or replace function chat.is_admin()
returns boolean
language sql
stable
security definer
set search_path = chat, public
as $$
  select exists (
    select 1 from chat.agents
     where id = auth.uid() and is_active and role = 'admin'
  );
$$;

comment on function chat.is_admin is 'Administrador ativo. Gerencia usuários e canais.';

create or replace function chat.is_manager()
returns boolean
language sql
stable
security definer
set search_path = chat, public
as $$
  select exists (
    select 1 from chat.agents
     where id = auth.uid() and is_active and role in ('admin', 'manager')
  );
$$;

comment on function chat.is_manager is
  'Gestor ou administrador ativo. Mexe em templates; não mexe em usuários.';

-- -----------------------------------------------------------------------------
-- SEMPRE SOBRA UM ADMINISTRADOR
-- -----------------------------------------------------------------------------
-- Um clique errado — rebaixar a si mesmo, desativar o último admin — deixaria
-- o painel sem ninguém capaz de conceder acesso, e o conserto seria por SQL
-- na unha. Barrar no banco cobre painel, API e psql de uma vez.

create or replace function chat.guard_last_admin()
returns trigger
language plpgsql
as $$
declare
  v_restantes integer;
begin
  -- Só interessa quando a linha deixa de ser um admin ativo.
  if tg_op = 'UPDATE'
     and old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
  then
    null;
  elsif tg_op = 'DELETE' and old.role = 'admin' and old.is_active then
    null;
  else
    return coalesce(new, old);
  end if;

  select count(*) into v_restantes
    from chat.agents
   where role = 'admin' and is_active and id <> old.id;

  if v_restantes = 0 then
    raise exception 'Este é o último administrador ativo: promova outra pessoa antes.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_agents_guard_last_admin on chat.agents;
create trigger trg_agents_guard_last_admin
  before update or delete on chat.agents
  for each row execute function chat.guard_last_admin();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

-- Template é conteúdo de atendimento, não configuração: gestor cuida.
-- A política antiga era restrita a admin; some para não ficarem duas regras
-- permissivas dizendo a mesma coisa com nomes diferentes.
drop policy if exists templates_admin_write on chat.templates;
drop policy if exists templates_write on chat.templates;
create policy templates_write on chat.templates
  for all to authenticated
  using (chat.is_manager()) with check (chat.is_manager());

-- Ninguém edita o próprio papel nem a própria ativação pela API do PostgREST.
-- A política de admin (agents_admin_all) continua valendo por cima desta.
drop policy if exists agents_update_self on chat.agents;
create policy agents_update_self on chat.agents
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from chat.agents where id = auth.uid())
    and is_active = (select is_active from chat.agents where id = auth.uid())
  );
