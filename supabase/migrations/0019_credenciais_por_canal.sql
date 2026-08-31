-- =============================================================================
-- 0019 — Credencial por canal, cifrada (Fase 4 do multiempresa)
-- =============================================================================
-- Até aqui o endereço e a chave da Evolution — e o token da Meta — viviam em
-- variável de ambiente do servidor: uma empresa, cravada no processo. Com
-- autoatendimento isso é impossível, e pior que impossível: a segunda empresa
-- mandaria mensagem pelo número da primeira sem ninguém notar.
--
-- A credencial passa para a linha do canal. O valor não fica na coluna: fica
-- no cofre do Postgres (supabase_vault), e a coluna guarda só o identificador.
-- Um pg_dump do banco leva o texto cifrado; a chave de cofre não está no dump.
--
-- `channels.token_ref` existe desde o primeiro dia com o comentário "nunca o
-- token em si" e nunca foi lida por linha nenhuma de código. Era o plano certo
-- para uma empresa só. Agora é implementado de verdade — e a coluna some.

alter table chat.channels
  -- Endereço do servidor daquele canal. Não é segredo, e separá-lo do resto é
  -- o que permite um dia mover um cliente para outra Evolution sem refatorar.
  add column if not exists base_url text,
  -- nome do segredo → id no cofre. Nunca o valor.
  add column if not exists secrets jsonb not null default '{}'::jsonb;

alter table chat.channels drop column if exists token_ref;

comment on column chat.channels.base_url is
  'Endereço da API daquele canal (Evolution). Vazio = usa o padrão do ambiente.';
comment on column chat.channels.secrets is
  'Mapa nome → id no vault. O valor do segredo nunca passa por esta coluna.';

-- -----------------------------------------------------------------------------
-- Gravar
-- -----------------------------------------------------------------------------
-- Quem grava é o administrador da empresa dona do canal, pelo painel. O valor
-- entra e não volta: não existe função que devolva segredo para o navegador.

create or replace function chat.set_channel_secret(
  p_channel_id uuid,
  p_name text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = chat, public, vault
as $$
declare
  v_company   uuid;
  v_existente uuid;
  v_nome      text;
begin
  if p_name !~ '^[a-z_]{3,40}$' then
    raise exception 'Nome de segredo inválido: %', p_name;
  end if;

  select company_id into v_company from chat.channels where id = p_channel_id;
  if v_company is null then
    raise exception 'Canal % não encontrado', p_channel_id;
  end if;

  if auth.uid() is not null and not (chat.is_admin() and v_company = chat.current_company()) then
    raise exception 'Só administradores da empresa mexem nas credenciais do canal'
      using errcode = 'insufficient_privilege';
  end if;

  v_nome := 'chat/channel/' || p_channel_id || '/' || p_name;
  v_existente := (select (secrets ->> p_name)::uuid from chat.channels where id = p_channel_id);

  if v_existente is null then
    v_existente := vault.create_secret(p_value, v_nome, 'Credencial de canal do Chat');
    update chat.channels
       set secrets = secrets || jsonb_build_object(p_name, v_existente::text)
     where id = p_channel_id;
  else
    perform vault.update_secret(v_existente, p_value);
  end if;
end;
$$;

create or replace function chat.clear_channel_secret(p_channel_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = chat, public, vault
as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  select company_id into v_company from chat.channels where id = p_channel_id;
  if v_company is null then
    raise exception 'Canal % não encontrado', p_channel_id;
  end if;

  if auth.uid() is not null and not (chat.is_admin() and v_company = chat.current_company()) then
    raise exception 'Só administradores da empresa mexem nas credenciais do canal'
      using errcode = 'insufficient_privilege';
  end if;

  v_id := (select (secrets ->> p_name)::uuid from chat.channels where id = p_channel_id);
  if v_id is not null then
    delete from vault.secrets where id = v_id;
    update chat.channels set secrets = secrets - p_name where id = p_channel_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ler — só o servidor
-- -----------------------------------------------------------------------------
-- Sem `grant` para authenticated. O painel nunca recebe credencial: ele mostra
-- quais estão preenchidas (chat.channel_secret_names) e mais nada. Quem manda
-- mensagem é o servidor, e é ele quem precisa do valor.

create or replace function chat.channel_credentials(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = chat, public, vault
as $$
declare
  v_canal   chat.channels;
  v_segredo record;
  v_out     jsonb;
begin
  select * into v_canal from chat.channels where id = p_channel_id;
  if not found then
    raise exception 'Canal % não encontrado', p_channel_id;
  end if;

  v_out := jsonb_build_object(
    'channelId',     v_canal.id,
    'companyId',     v_canal.company_id,
    'provider',      v_canal.provider,
    'instanceName',  v_canal.instance_name,
    'phoneNumberId', v_canal.phone_number_id,
    'wabaId',        v_canal.waba_id,
    'baseUrl',       v_canal.base_url,
    'isActive',      v_canal.is_active
  );

  for v_segredo in
    select s.key as nome, d.decrypted_secret as valor
      from jsonb_each_text(v_canal.secrets) s(key, value)
      join vault.decrypted_secrets d on d.id = s.value::uuid
  loop
    v_out := v_out || jsonb_build_object(v_segredo.nome, v_segredo.valor);
  end loop;

  return v_out;
end;
$$;

-- O painel só precisa saber o que já foi preenchido, para mostrar "definida"
-- ao lado do campo em vez do valor.
create or replace function chat.channel_secret_names(p_channel_id uuid)
returns text[]
language sql
stable
security definer
set search_path = chat, public
as $$
  select coalesce(array_agg(key order by key), '{}')
    from chat.channels c, jsonb_each_text(c.secrets)
   where c.id = p_channel_id
     and c.company_id = chat.current_company();
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------

revoke all on function chat.channel_credentials(uuid) from public, authenticated;
grant execute on function chat.channel_credentials(uuid) to service_role;

grant execute on function chat.set_channel_secret(uuid, text, text)   to authenticated, service_role;
grant execute on function chat.clear_channel_secret(uuid, text)       to authenticated, service_role;
grant execute on function chat.channel_secret_names(uuid)             to authenticated, service_role;
