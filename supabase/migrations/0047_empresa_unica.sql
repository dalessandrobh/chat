-- =============================================================================
-- 0047 — Duas empresas com o mesmo nome, não
-- =============================================================================
-- Em 28/09/2026 o administrador da Eco Aquecedores foi removido do Chat sem
-- querer (o e-mail certo tinha sido apagado em Usuários; o que ficou era um com
-- erro de digitação). Ao entrar, ele caiu na tela de criar empresa. Se o fluxo
-- tivesse deixado, existiriam duas "Eco Aquecedores" — a de verdade, com as
-- conversas, e a nova, vazia, que é a que ele veria dali em diante.
--
-- Nome repetido não é conflito de banco, é gente perdida: quem procura a
-- própria empresa e encontra duas não tem como saber qual é. Então o nome
-- passa a ser único, comparado como se lê — sem acento, sem maiúscula, sem
-- espaço sobrando — e a recusa diz o que fazer.

begin;

-- A trava dura, para o caso de alguém inserir por fora da função.
--
-- Maiúscula e espaço sobrando entram na comparação: "Eco  Aquecedores" e "eco
-- aquecedores" são o mesmo nome para quem lê. `lower`, `btrim` e
-- `regexp_replace` são imutáveis; `unaccent` não é, e por isso o acento fica
-- só na comparação da função.
drop index if exists chat.idx_companies_nome_unico;
create unique index idx_companies_nome_unico
  on chat.companies (regexp_replace(lower(btrim(name)), '\s+', ' ', 'g'));

create or replace function chat.create_company(p_name text)
returns uuid
language plpgsql
security definer
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

  -- Já existe uma com este nome: quase sempre é a própria empresa de quem está
  -- na tela, e o que falta é acesso, não empresa.
  if exists (
    select 1 from chat.companies c
     where regexp_replace(lower(unaccent(btrim(c.name))), '\s+', ' ', 'g')
         = regexp_replace(lower(unaccent(btrim(p_name))), '\s+', ' ', 'g')
  ) then
    raise exception 'Já existe uma empresa com este nome. Se é a sua, peça ao administrador dela para liberar seu acesso em Usuários.'
      using errcode = 'unique_violation';
  end if;

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

  update chat.agents
     set company_id = v_id,
         role       = 'admin',
         is_active  = true
   where id = v_agent;

  insert into chat.company_profile (company_id) values (v_id)
    on conflict (company_id) do nothing;
  perform chat.seed_qualification(v_id);

  return v_id;
end;
$$;

grant execute on function chat.create_company(text) to authenticated;

commit;

notify pgrst, 'reload schema';
