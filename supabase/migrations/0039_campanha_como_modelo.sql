-- A campanha guarda o próprio recorte, e o canal tem um padrão.
--
-- Duas faltas que apareceram juntas na semana passada.
--
-- A primeira: campanha enviada é memória, mas memória inútil. Grupo e etiqueta
-- escolhidos viravam destinatários e sumiam — quem quisesse repetir a campanha
-- do mês passado refazia a escolha na mão, torcendo para lembrar. Agora o
-- recorte fica na linha, e é dele que a fila é montada: `enqueue_campaign`
-- deixa de receber os filtros por parâmetro e passa a lê-los da campanha. Uma
-- fonte só, impossível de divergir.
--
-- Isso é o que faz "usar como modelo" existir: a cópia leva texto, ritmo e
-- recorte, e monta a fila contra a base de HOJE — quem entrou depois entra,
-- quem pediu para sair fica de fora. Repetir a campanha não é reenviar para a
-- mesma lista congelada; é fazer a mesma pergunta de novo.
--
-- A segunda: a escolha do canal. Depois que a empresa passou a ter dois
-- números, "o canal" virou uma loteria — e uma campanha inteira saiu pelo
-- número desconectado. A tela já escolhe explicitamente; falta o padrão, para
-- quem não quer escolher toda vez. Padrão tem que ser canal ativo: um padrão
-- pausado é a mesma loteria com outro nome.

begin;

-- -----------------------------------------------------------------------------
-- O recorte mora na campanha
-- -----------------------------------------------------------------------------

alter table chat.campaigns
  add column if not exists tags       text[]  not null default '{}',
  add column if not exists group_ids  uuid[]  not null default '{}',
  add column if not exists sem_grupo  boolean not null default false;

comment on column chat.campaigns.tags is
  'Etiquetas do recorte. Vazio é "todas". Somam com group_ids usando E.';
comment on column chat.campaigns.group_ids is
  'Grupos do recorte. Vazio, com sem_grupo falso, é "todos os grupos".';
comment on column chat.campaigns.sem_grupo is
  'Inclui quem não tem grupo. É um recorte, não a ausência de filtro.';

-- Arrays vazios em vez de nulos: "sem filtro" e "filtro vazio" seriam a mesma
-- coisa escrita de dois jeitos, e um dia alguém leria um pelo outro.

-- -----------------------------------------------------------------------------
-- A fila é montada a partir do que a campanha diz
-- -----------------------------------------------------------------------------

drop function if exists chat.enqueue_campaign(uuid, text[], uuid[], boolean);

create or replace function chat.enqueue_campaign(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_total   integer;
  v_company uuid;
  c         chat.campaigns;
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores montam campanhas'
      using errcode = 'insufficient_privilege';
  end if;

  select * into c from chat.campaigns where id = p_campaign_id;
  if not found then
    raise exception 'Campanha % não encontrada', p_campaign_id;
  end if;

  v_company := c.company_id;
  perform chat.assert_same_company(v_company);

  -- Canal pausado não monta fila. O `claim_next_send` já o ignora na hora do
  -- envio, mas descobrir isso só ali é descobrir com a campanha criada e
  -- ninguém entendendo por que ela não anda.
  if not exists (select 1 from chat.channels ch
                  where ch.id = c.channel_id and ch.is_active) then
    raise exception 'O canal desta campanha está pausado'
      using errcode = 'PT409';
  end if;

  insert into chat.campaign_recipients (campaign_id, audience_id, name, wa_id, company_id)
  select p_campaign_id, a.id, a.name, a.wa_id, v_company
    from chat.audience a
   where a.company_id = v_company
     and a.is_sendable
     and (cardinality(c.tags) = 0 or a.tags && c.tags)
     and (
       -- Sem recorte de grupo nenhum: a base inteira.
       (cardinality(c.group_ids) = 0 and not c.sem_grupo)
       or a.group_id = any(c.group_ids)
       or (c.sem_grupo and a.group_id is null)
     )
  on conflict (campaign_id, audience_id) do nothing;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function chat.enqueue_campaign(uuid) is
  'Monta a fila a partir do recorte gravado na própria campanha. Grupo e etiqueta somam com E.';

revoke all on function chat.enqueue_campaign(uuid) from public;
grant execute on function chat.enqueue_campaign(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- O canal padrão
-- -----------------------------------------------------------------------------

alter table chat.channels
  add column if not exists is_default boolean not null default false;

comment on column chat.channels.is_default is
  'O canal que as campanhas usam quando ninguém escolhe. Um por empresa, e sempre ativo.';

-- Um por empresa. Índice parcial, e não constraint: só a linha marcada compete.
create unique index if not exists channels_um_padrao_por_empresa
  on chat.channels (company_id) where is_default;

/**
 * Padrão pausado é a mesma loteria de antes, com outro nome.
 *
 * O gatilho cobre os dois lados: marcar como padrão um canal pausado é erro, e
 * pausar o canal padrão simplesmente tira o padrão — recusar aqui deixaria o
 * botão "Pausar" da tela de Canais falhando por um motivo que não é dele.
 */
create or replace function chat.padrao_so_com_canal_ativo()
returns trigger
language plpgsql
as $$
begin
  if new.is_default and not new.is_active then
    -- Pausar um canal que era padrão: ele deixa de ser, calado.
    if tg_op = 'UPDATE' and old.is_active and not new.is_active then
      new.is_default := false;
      return new;
    end if;

    raise exception 'O canal padrão precisa estar ativo'
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_channels_padrao_ativo on chat.channels;
create trigger trg_channels_padrao_ativo before insert or update on chat.channels
  for each row execute function chat.padrao_so_com_canal_ativo();

/**
 * Marcar o padrão, tirando o de antes.
 *
 * Uma função e não um `update` da tela porque são duas escritas que precisam
 * andar juntas: sem isso, um clique que falhasse no meio deixaria a empresa
 * com dois padrões — ou com nenhum, que é pior, porque a campanha seguinte
 * cairia de volta na escolha arbitrária.
 */
create or replace function chat.definir_canal_padrao(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
  v_ativo   boolean;
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores definem o canal padrão'
      using errcode = 'insufficient_privilege';
  end if;

  select ch.company_id, ch.is_active into v_company, v_ativo
    from chat.channels ch where ch.id = p_channel_id;

  if v_company is null then
    raise exception 'Canal não encontrado';
  end if;

  perform chat.assert_same_company(v_company);

  if not v_ativo then
    raise exception 'Um canal pausado não pode ser o padrão'
      using errcode = 'PT409';
  end if;

  update chat.channels set is_default = false
   where company_id = v_company and is_default and id <> p_channel_id;

  update chat.channels set is_default = true where id = p_channel_id;
end;
$$;

revoke all on function chat.definir_canal_padrao(uuid) from public;
grant execute on function chat.definir_canal_padrao(uuid) to authenticated, service_role;

-- A empresa que já tem um canal ativo só ganha o padrão dele: sem isto, a
-- primeira campanha depois desta migration voltaria a escolher sozinha.
update chat.channels ch
   set is_default = true
 where ch.is_active
   and not exists (select 1 from chat.channels o
                    where o.company_id = ch.company_id and o.is_default)
   and ch.id = (select id from chat.channels o
                 where o.company_id = ch.company_id and o.is_active
                 order by o.connection_state = 'open' desc, o.created_at
                 limit 1);

commit;

notify pgrst, 'reload schema';
