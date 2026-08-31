-- =============================================================================
-- Isolamento entre empresas — teste que afirma o negativo
-- =============================================================================
-- Rodar:
--   docker exec -i <container-do-postgres> psql -U supabase_admin -d postgres \
--     -f /caminho/isolamento.sql
--
-- Roda inteiro dentro de uma transação e desfaz no fim: cria uma empresa
-- fantasma, um agente dela e um pouco de dado, e afirma que nenhum dos dois
-- lados enxerga o outro. Falhou uma linha, o script para com erro.
--
-- Por que SQL e não teste de aplicação: o que está sendo testado é a regra de
-- acesso do banco. Testar pela aplicação testaria o cliente HTTP no caminho —
-- e é justamente o banco que precisa negar mesmo quando o cliente erra.

\set ON_ERROR_STOP on
begin;

\echo ''
\echo '=== preparando duas empresas ==='

insert into chat.companies (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'Empresa Fantasma A', 'teste-a'),
       ('22222222-2222-2222-2222-222222222222', 'Empresa Fantasma B', 'teste-b');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-1111-1111-1111111111aa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@teste.local','x',now(),now()),
       ('22222222-2222-2222-2222-2222222222bb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@teste.local','x',now(),now());

-- O gatilho handle_new_user já criou as linhas; aqui só se completa.
update chat.agents set full_name='Agente A', role='admin', is_active=true,
       company_id='11111111-1111-1111-1111-111111111111'
 where id='11111111-1111-1111-1111-1111111111aa';
update chat.agents set full_name='Agente B', role='admin', is_active=true,
       company_id='22222222-2222-2222-2222-222222222222'
 where id='22222222-2222-2222-2222-2222222222bb';

insert into chat.channels (id,name,provider,instance_name,company_id) values
 ('11111111-0000-0000-0000-0000000000c1','Canal A','evolution','teste-canal-a','11111111-1111-1111-1111-111111111111'),
 ('22222222-0000-0000-0000-0000000000c1','Canal B','evolution','teste-canal-b','22222222-2222-2222-2222-222222222222');

insert into chat.contacts (id,channel_id,wa_id,company_id) values
 ('11111111-0000-0000-0000-0000000000c2','11111111-0000-0000-0000-0000000000c1','5500000000001','11111111-1111-1111-1111-111111111111'),
 ('22222222-0000-0000-0000-0000000000c2','22222222-0000-0000-0000-0000000000c1','5500000000001','22222222-2222-2222-2222-222222222222');

insert into chat.conversations (id,channel_id,contact_id,company_id) values
 ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1','11111111-0000-0000-0000-0000000000c2','11111111-1111-1111-1111-111111111111'),
 ('22222222-0000-0000-0000-0000000000c3','22222222-0000-0000-0000-0000000000c1','22222222-0000-0000-0000-0000000000c2','22222222-2222-2222-2222-222222222222');

insert into chat.messages (conversation_id,channel_id,direction,type,body,author,company_id) values
 ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1','in','text','segredo da A','contact','11111111-1111-1111-1111-111111111111'),
 ('22222222-0000-0000-0000-0000000000c3','22222222-0000-0000-0000-0000000000c1','in','text','segredo da B','contact','22222222-2222-2222-2222-222222222222');

insert into chat.knowledge (title,content,position,is_active,company_id) values
 ('Preço A','R$ 1,00',1,true,'11111111-1111-1111-1111-111111111111'),
 ('Preço B','R$ 2,00',1,true,'22222222-2222-2222-2222-222222222222');

-- O mesmo número nas duas listas: era impossível antes, e é o caso que o
-- descadastro precisa distinguir.
insert into chat.audience (name,wa_id,company_id) values
 ('Contato compartilhado','5500000000001','11111111-1111-1111-1111-111111111111'),
 ('Contato compartilhado','5500000000001','22222222-2222-2222-2222-222222222222');

-- -----------------------------------------------------------------------------
\echo '=== A não enxerga nada de B ==='

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';

do $$
begin
  if chat.current_company() <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHOU: current_company() devolveu a empresa errada';
  end if;
  if exists (select 1 from chat.messages      where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê mensagem de B';
  end if;
  if exists (select 1 from chat.conversations where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê conversa de B';
  end if;
  if exists (select 1 from chat.inbox where conversation_id = '22222222-0000-0000-0000-0000000000c3') then
    raise exception 'FALHOU: A vê a conversa de B pela view inbox';
  end if;
  if exists (select 1 from chat.contacts  where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê contato de B';
  end if;
  if exists (select 1 from chat.channels  where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê canal de B';
  end if;
  if exists (select 1 from chat.knowledge where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê a base de B';
  end if;
  if exists (select 1 from chat.audience  where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê a lista de envio de B';
  end if;
  if exists (select 1 from chat.agents    where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê a equipe de B';
  end if;
  if exists (select 1 from chat.companies where id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê a empresa B';
  end if;
  raise notice 'ok: A não enxerga nada de B';
end $$;

\echo '=== A não age sobre B ==='

do $$
begin
  begin
    perform chat.take_over('22222222-0000-0000-0000-0000000000c3', 'invasão');
    raise exception 'FALHOU: A assumiu conversa de B';
  exception when insufficient_privilege then null;
  end;

  begin
    perform chat.hand_back('22222222-0000-0000-0000-0000000000c3', 'invasão');
    raise exception 'FALHOU: A devolveu conversa de B ao bot';
  exception when insufficient_privilege then null;
  end;

  begin
    perform chat.mark_read('22222222-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: A marcou como lida a conversa de B';
  exception when insufficient_privilege then null;
  end;

  begin
    perform chat.opt_out('22222222-2222-2222-2222-222222222222', '5500000000001');
    raise exception 'FALHOU: A descadastrou contato na lista de B';
  exception when insufficient_privilege then null;
  end;

  raise notice 'ok: A não age sobre B';
end $$;

\echo '=== o prompt de A não leva a base de B ==='

do $$
declare
  v_base text := chat.render_knowledge('11111111-1111-1111-1111-111111111111');
begin
  if v_base not like '%Preço A%' then
    raise exception 'FALHOU: a base de A não chegou ao prompt';
  end if;
  if v_base like '%Preço B%' then
    raise exception 'FALHOU: a base de B vazou para o prompt de A';
  end if;
  raise notice 'ok: prompt de A só tem a base de A';
end $$;

reset role;

\echo '=== o descadastro de A não atinge B ==='

do $$
begin
  perform chat.opt_out('11111111-1111-1111-1111-111111111111', '5500000000001');

  if exists (select 1 from chat.audience
              where company_id = '11111111-1111-1111-1111-111111111111'
                and wa_id = '5500000000001' and is_sendable) then
    raise exception 'FALHOU: o descadastro não tirou o contato da lista de A';
  end if;

  if not exists (select 1 from chat.audience
                  where company_id = '22222222-2222-2222-2222-222222222222'
                    and wa_id = '5500000000001' and is_sendable) then
    raise exception 'FALHOU: descadastrar em A tirou o contato da lista de B';
  end if;

  raise notice 'ok: descadastro fica na empresa que recebeu o pedido';
end $$;

\echo '=== importar a base de B não apaga a de A ==='

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-2222222222bb","role":"authenticated"}';

do $$
begin
  perform chat.replace_knowledge('[{"title":"Nova B","content":"x","position":1,"is_active":true}]'::jsonb);
end $$;

reset role;

do $$
begin
  if not exists (select 1 from chat.knowledge
                  where company_id = '11111111-1111-1111-1111-111111111111'
                    and title = 'Preço A') then
    raise exception 'FALHOU: importar a base de B apagou a base de A';
  end if;
  raise notice 'ok: a importação de uma empresa não toca na outra';
end $$;

\echo '=== credencial de canal não atravessa empresa ==='

-- A da empresa A é gravada por ela, e some do alcance de B.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  perform chat.set_channel_secret('11111111-0000-0000-0000-0000000000c1', 'api_key', 'segredo-da-empresa-a');

  begin
    perform chat.set_channel_secret('22222222-0000-0000-0000-0000000000c1', 'api_key', 'invasao');
    raise exception 'FALHOU: A gravou credencial no canal de B';
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from unnest(chat.channel_secret_names('22222222-0000-0000-0000-0000000000c1'))) > 0 then
    raise exception 'FALHOU: A lista as credenciais do canal de B';
  end if;

  raise notice 'ok: A não grava nem lista credencial de B';
end $$;
reset role;

-- E o painel não tem caminho para o valor: channel_credentials é só do servidor.
do $$
declare v_tem boolean;
begin
  select has_function_privilege('authenticated', 'chat.channel_credentials(uuid)', 'execute') into v_tem;
  if v_tem then
    raise exception 'FALHOU: o navegador pode ler credenciais decifradas';
  end if;

  if (chat.channel_credentials('11111111-0000-0000-0000-0000000000c1') ->> 'api_key')
     <> 'segredo-da-empresa-a' then
    raise exception 'FALHOU: o servidor não leu a credencial de volta';
  end if;

  raise notice 'ok: só o servidor lê credencial, e lê a certa';
end $$;

\echo '=== cadastro de empresa ==='

-- Quem já tem empresa não cria outra: senão o cadastro vira jeito de encher
-- o banco, e a pessoa acabaria com duas contas sem querer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  begin
    perform chat.create_company('Segunda empresa do mesmo dono');
    raise exception 'FALHOU: quem já tem empresa criou outra';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok: quem já tem empresa não cria outra';
end $$;
reset role;

-- Quem chega sozinho cria a sua e vira administrador dela.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('33333333-3333-3333-3333-3333333333cc','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@teste.local','x',now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-3333333333cc","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  if chat.current_company() is not null then
    raise exception 'FALHOU: recém-cadastrado já nasceu com empresa';
  end if;

  v_id := chat.create_company('Empresa Fantasma C');

  if (select company_id from chat.agents where id = auth.uid()) <> v_id then
    raise exception 'FALHOU: a empresa criada não ficou com quem criou';
  end if;
  if (select role::text from chat.agents where id = auth.uid()) <> 'admin' then
    raise exception 'FALHOU: quem criou a empresa não virou administrador';
  end if;
  if exists (select 1 from chat.messages) then
    raise exception 'FALHOU: empresa nova enxerga mensagem de outra';
  end if;

  raise notice 'ok: quem chega sozinho cria a própria empresa e não vê as outras';
end $$;
reset role;

\echo '=== acesso de plataforma não vaza pela RLS ==='

do $$
begin
  -- A visão ampla existe, mas não pelo navegador: é chave de serviço, por uma
  -- porta separada e registrada.
  if has_function_privilege('authenticated', 'chat.platform_overview()', 'execute') then
    raise exception 'FALHOU: o navegador pode listar todas as empresas';
  end if;

  -- E nenhuma política tem exceção para dono de plataforma.
  if exists (
    select 1 from pg_policy p
     where pg_get_expr(p.polqual, p.polrelid) like '%is_platform_owner%'
        or pg_get_expr(p.polwithcheck, p.polrelid) like '%is_platform_owner%'
  ) then
    raise exception 'FALHOU: alguma política ganhou exceção de plataforma';
  end if;

  raise notice 'ok: plataforma é porta separada, não exceção na regra';
end $$;

\echo '=== desconhecido logado não vê nada ==='

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';

do $$
begin
  if chat.current_company() is not null then
    raise exception 'FALHOU: desconhecido tem empresa';
  end if;
  if exists (select 1 from chat.inbox) then
    raise exception 'FALHOU: desconhecido vê conversas pela view inbox';
  end if;
  if exists (select 1 from chat.messages) then
    raise exception 'FALHOU: desconhecido vê mensagens';
  end if;
  raise notice 'ok: desconhecido não vê nada';
end $$;

reset role;

\echo ''
\echo '=== TODOS OS TESTES PASSARAM ==='
rollback;
