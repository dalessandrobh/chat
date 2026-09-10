-- Grupos de contato, e o "não enviar" na mão.
--
-- A base de envio já tinha etiquetas, e etiqueta é boa para o que se acumula:
-- um contato pode ser "sul", "obra nova" e "pediu catálogo" ao mesmo tempo. Só
-- que nem tudo se acumula. Revendedor não é consumidor final, e as duas coisas
-- pedem campanhas diferentes com textos diferentes — isso é um lugar onde o
-- contato está, não um adjetivo que ele tem.
--
-- Então o grupo é **um só, ou nenhum**. Se fossem vários, seria etiqueta com
-- outro nome, e a tela teria duas maneiras de fazer a mesma coisa.
--
-- Na campanha os dois se somam com E: grupo "Revendedores" mais etiqueta "sul"
-- atinge quem está nos dois. Quem quiser a união monta duas campanhas — que é
-- o que ela é de verdade, com texto próprio para cada lado.

begin;

-- -----------------------------------------------------------------------------
-- O grupo
-- -----------------------------------------------------------------------------

create table if not exists chat.contact_groups (
  id         uuid primary key default gen_random_uuid(),
  /** Como em `contact_memory`: a tela grava sem carregar o id da empresa. */
  company_id uuid not null default chat.current_company()
               references chat.companies(id) on delete cascade,
  nome       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_groups_nome check (char_length(btrim(nome)) between 1 and 60),
  -- Par único para a chave composta que a base de envio usa lá embaixo.
  constraint contact_groups_id_empresa unique (id, company_id)
);

comment on table chat.contact_groups is
  'Onde o contato está, não o que ele é: um grupo por contato, ou nenhum. O que se acumula são as etiquetas.';

-- "Revendedores" e "revendedores" são o mesmo grupo digitado duas vezes.
create unique index if not exists contact_groups_sem_repetido
  on chat.contact_groups (company_id, lower(btrim(nome)));

drop trigger if exists trg_contact_groups_touch on chat.contact_groups;
create trigger trg_contact_groups_touch before update on chat.contact_groups
  for each row execute function chat.touch_updated_at();

alter table chat.contact_groups enable row level security;

-- Ler é de quem atende: a tela de campanha precisa listar os grupos para
-- segmentar. Mexer na organização da base continua sendo de gestor, como o
-- resto da base de envio.
drop policy if exists contact_groups_leitura on chat.contact_groups;
create policy contact_groups_leitura on chat.contact_groups
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists contact_groups_escrita on chat.contact_groups;
create policy contact_groups_escrita on chat.contact_groups
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

grant select, insert, update, delete on chat.contact_groups to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- O contato aponta para o grupo
-- -----------------------------------------------------------------------------
-- Apagar um grupo não apaga contato nenhum: eles voltam a não ter grupo. É a
-- diferença entre desfazer uma organização e perder a base.
--
-- A chave é composta para o banco exigir que grupo e contato sejam da mesma
-- empresa, e o `set null` nomeia a coluna — sem isso ele zeraria `company_id`
-- junto, que é `not null`, e apagar um grupo passaria a dar erro.

alter table chat.audience
  add column if not exists group_id uuid;

alter table chat.audience drop constraint if exists audience_do_grupo;
alter table chat.audience
  add constraint audience_do_grupo
  foreign key (group_id, company_id)
  references chat.contact_groups (id, company_id)
  on delete set null (group_id);

comment on column chat.audience.group_id is
  'Grupo do contato, ou nulo. Apagar o grupo devolve os contatos para "sem grupo".';

create index if not exists idx_audience_grupo
  on chat.audience (company_id, group_id);

-- -----------------------------------------------------------------------------
-- A campanha passa a segmentar por grupo também
-- -----------------------------------------------------------------------------
-- `p_sem_grupo` existe porque "sem grupo" é um recorte de verdade — quem
-- entrou pela última planilha e ninguém organizou ainda — e não caberia numa
-- lista de ids. Nenhum dos dois preenchido quer dizer "todos os grupos", que é
-- como a função se comportava antes desta migration.

drop function if exists chat.enqueue_campaign(uuid, text[]);

create or replace function chat.enqueue_campaign(
  p_campaign_id uuid,
  p_tags        text[]  default null,
  p_group_ids   uuid[]  default null,
  p_sem_grupo   boolean default false
)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_total   integer;
  v_company uuid;
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores montam campanhas'
      using errcode = 'insufficient_privilege';
  end if;

  select company_id into v_company from chat.campaigns where id = p_campaign_id;
  if v_company is null then
    raise exception 'Campanha % não encontrada', p_campaign_id;
  end if;

  perform chat.assert_same_company(v_company);

  -- Só quem pode receber, e só da lista desta empresa.
  insert into chat.campaign_recipients (campaign_id, audience_id, name, wa_id, company_id)
  select p_campaign_id, a.id, a.name, a.wa_id, v_company
    from chat.audience a
   where a.company_id = v_company
     and a.is_sendable
     and (p_tags is null or a.tags && p_tags)
     and (
       -- Sem filtro de grupo nenhum: a base inteira, como era antes.
       (p_group_ids is null and not p_sem_grupo)
       or a.group_id = any(coalesce(p_group_ids, '{}'::uuid[]))
       or (p_sem_grupo and a.group_id is null)
     )
  on conflict (campaign_id, audience_id) do nothing;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function chat.enqueue_campaign(uuid, text[], uuid[], boolean) is
  'Monta a fila de destinatários. Grupo e etiqueta se somam com E; nenhum dos dois é a base inteira.';

revoke all on function chat.enqueue_campaign(uuid, text[], uuid[], boolean) from public;
grant execute on function chat.enqueue_campaign(uuid, text[], uuid[], boolean)
  to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
