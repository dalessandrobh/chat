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
       -- Uma segunda pessoa na empresa A: sem ela não dá para testar o que
       -- acontece quando duas mãos vão para a mesma conversa.
       ('11111111-1111-1111-1111-1111111111a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a2@teste.local','x',now(),now()),
       ('22222222-2222-2222-2222-2222222222bb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@teste.local','x',now(),now());

-- O gatilho handle_new_user já criou as linhas; aqui só se completa.
--
-- `created_at` recuado de propósito: o piso de não lidas de quem nunca abriu a
-- conversa é a entrada do agente na empresa, e dentro de uma transação `now()`
-- é o mesmo instante para o agente e para a mensagem — sem recuar, nada seria
-- "depois" de nada.
update chat.agents set full_name='Agente A', role='admin', is_active=true,
       company_id='11111111-1111-1111-1111-111111111111',
       created_at = now() - interval '1 day'
 where id='11111111-1111-1111-1111-1111111111aa';
update chat.agents set full_name='Agente A2', role='agent', is_active=true,
       company_id='11111111-1111-1111-1111-111111111111',
       created_at = now() - interval '1 day'
 where id='11111111-1111-1111-1111-1111111111a2';
update chat.agents set full_name='Agente B', role='admin', is_active=true,
       company_id='22222222-2222-2222-2222-222222222222',
       created_at = now() - interval '1 day'
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

-- As diretrizes do agente são tão da empresa quanto a base: o perfil de uma
-- no prompt da outra faria o bot atender em nome de quem não é.
insert into chat.company_profile (company_id,apresentacao,horario_semana) values
 ('11111111-1111-1111-1111-111111111111','Segredo do perfil de A',
  '{"1":{"abre":"08:00","fecha":"18:00"}}'::jsonb),
 ('22222222-2222-2222-2222-222222222222','Segredo do perfil de B','{}'::jsonb);

insert into chat.qualification_fields (company_id,chave,pergunta,position) values
 ('11111111-1111-1111-1111-111111111111','pergunta_a','o que só A pergunta',10),
 ('22222222-2222-2222-2222-222222222222','pergunta_b','o que só B pergunta',10);

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
  -- A view da lista é `security_invoker`, e um `create or replace view` devolve
  -- as reloptions ao padrão sem avisar. Sem esta linha, a próxima alteração da
  -- view pode abrir a inbox de todo mundo e passar no resto do teste.
  if exists (select 1 from chat.inbox where conversation_id = '22222222-0000-0000-0000-0000000000c3') then
    raise exception 'FALHOU: A vê a conversa de B na lista';
  end if;
  if exists (select 1 from chat.knowledge where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê a base de B';
  end if;
  if exists (select 1 from chat.company_profile where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê as diretrizes de B';
  end if;
  if exists (select 1 from chat.qualification_fields where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A vê a qualificação de B';
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
    perform chat.atribuir_conversa('22222222-0000-0000-0000-0000000000c3',
                                   '11111111-1111-1111-1111-1111111111aa');
    raise exception 'FALHOU: A direcionou para si a conversa de B';
  exception when insufficient_privilege then null;
  end;

  begin
    perform chat.liberar_para_fila('22222222-0000-0000-0000-0000000000c3', 'invasão');
    raise exception 'FALHOU: A liberou para a fila a conversa de B';
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

do $$
declare
  v_perfil text := chat.render_company_profile('11111111-1111-1111-1111-111111111111');
begin
  if v_perfil not like '%Segredo do perfil de A%' then
    raise exception 'FALHOU: as diretrizes de A não chegaram ao prompt';
  end if;

  -- A função é security definer e recebe a empresa por parâmetro: sem a
  -- guarda de dentro dela, bastaria trocar o uuid.
  begin
    perform chat.render_company_profile('22222222-2222-2222-2222-222222222222');
    raise exception 'FALHOU: A montou as diretrizes de B';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'ok: diretrizes de A só chegam a A';
end $$;

-- O horário decide se o cliente ouve "um atendente entra em contato amanhã".
-- Lido da empresa errada, o aviso sai na hora errada.
do $$
declare
  -- Segunda-feira às 22h em Brasília: fora do expediente de A.
  v_fora  timestamptz := '2026-09-07 22:00:00-03';
  v_agora jsonb := chat.horario_de_atendimento('11111111-1111-1111-1111-111111111111', v_fora);
begin
  if (v_agora->>'aberta')::boolean or not (v_agora->>'configurado')::boolean then
    raise exception 'FALHOU: horario_de_atendimento contou a história errada de A';
  end if;

  begin
    perform chat.horario_de_atendimento('22222222-2222-2222-2222-222222222222');
    raise exception 'FALHOU: A leu o expediente de B';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'ok: o expediente de A não vaza para B';
end $$;

reset role;

\echo '=== o expediente decide a hora certa ==='

-- `empresa_aberta` é peça interna: não é concedida a `authenticated`, então
-- este bloco roda fora do papel. Quem entra pelo painel usa a de cima.
do $$
declare
  v_dentro timestamptz := '2026-09-07 10:00:00-03';  -- segunda, 10h
  v_fora   timestamptz := '2026-09-07 22:00:00-03';  -- segunda, 22h
begin
  if not chat.empresa_aberta('11111111-1111-1111-1111-111111111111', v_dentro) then
    raise exception 'FALHOU: A deveria estar aberta na segunda às 10h';
  end if;
  if chat.empresa_aberta('11111111-1111-1111-1111-111111111111', v_fora) then
    raise exception 'FALHOU: A deveria estar fechada na segunda às 22h';
  end if;

  -- B não cadastrou horário: 24 horas, e nunca um aviso de "volto amanhã".
  if not chat.empresa_aberta('22222222-2222-2222-2222-222222222222', v_fora) then
    raise exception 'FALHOU: empresa sem horário cadastrado deixou de ser 24 horas';
  end if;

  -- A só abre na segunda, então às 22h de segunda a próxima é a segunda
  -- seguinte. A busca precisa varrer a semana inteira para achá-la.
  if chat.proxima_abertura('11111111-1111-1111-1111-111111111111', v_fora)
     <> '2026-09-14 08:00:00-03'::timestamptz then
    raise exception 'FALHOU: a próxima abertura de A não é a segunda seguinte';
  end if;
  if chat.proxima_abertura('22222222-2222-2222-2222-222222222222', v_fora) is not null then
    raise exception 'FALHOU: empresa 24 horas não tem próxima abertura';
  end if;

  raise notice 'ok: aberto, fechado e a próxima abertura batem';
end $$;

\echo '=== fora do expediente, quem atende a fila é o bot ==='

-- Escalar às onze da noite deixa a conversa na fila humana, e a equipe só
-- volta pela manhã. Até lá o bot continua atendendo — senão o aviso de "um
-- atendente entra em contato amanhã" seria seguido de nove horas de silêncio.
do $$
declare
  v_conversa uuid := '11111111-0000-0000-0000-0000000000c3';
  v_fora     timestamptz := '2026-09-07 22:00:00-03';  -- segunda, 22h
  v_dentro   timestamptz := '2026-09-07 10:00:00-03';  -- segunda, 10h
begin
  update chat.conversations
     set mode = 'human', status = 'pending', assigned_agent_id = null
   where id = v_conversa;

  if not chat.fila_fora_do_expediente(v_conversa, v_fora) then
    raise exception 'FALHOU: às 22h a fila de A deveria continuar com o bot';
  end if;

  -- Em expediente a fila é de gente: quem espera pediu uma pessoa, e o bot
  -- falar por cima seria desfazer o que o cliente pediu.
  if chat.fila_fora_do_expediente(v_conversa, v_dentro) then
    raise exception 'FALHOU: com a empresa aberta o bot falou pela fila';
  end if;

  -- Com dono, nunca. A trava do handoff não tem exceção de horário.
  update chat.conversations
     set assigned_agent_id = '11111111-1111-1111-1111-1111111111aa'
   where id = v_conversa;

  if chat.fila_fora_do_expediente(v_conversa, v_fora) then
    raise exception 'FALHOU: o bot responderia por cima de um atendente';
  end if;

  -- E a empresa sem horário cadastrado é 24 horas: nunca há fila fora do
  -- expediente, porque não há fora do expediente.
  update chat.conversations
     set mode = 'human', status = 'pending', assigned_agent_id = null
   where id = '22222222-0000-0000-0000-0000000000c3';

  if chat.fila_fora_do_expediente('22222222-0000-0000-0000-0000000000c3', v_fora) then
    raise exception 'FALHOU: empresa 24 horas passou a ter fila fora do expediente';
  end if;

  -- Devolve as duas ao estado em que as seções seguintes as esperam.
  update chat.conversations
     set mode = 'bot', status = 'open', assigned_agent_id = null
   where id in (v_conversa, '22222222-0000-0000-0000-0000000000c3');

  raise notice 'ok: fora do expediente o bot atende a fila; em expediente, não';
end $$;

\echo '=== a memória do contato para na empresa dele ==='

-- Memória é o que se sabe da pessoa entre uma conversa e outra, e por isso é
-- o dado mais fácil de vazar sem ninguém notar: ninguém abre a tela do
-- contato de outra empresa, mas o prompt lê sozinho, toda mensagem.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111a2","role":"authenticated"}';
do $$
declare
  v_contato_a uuid := '11111111-0000-0000-0000-0000000000c2';
  v_contato_b uuid := '22222222-0000-0000-0000-0000000000c2';
begin
  -- Atendente comum anota à mão: é ferramenta de quem atende, e A2 é 'agent'.
  -- `company_id` nem é passado — o default lê de quem está logado.
  insert into chat.contact_memory (contact_id, fato, origem)
  values (v_contato_a, 'prefere ser chamada de Bia', 'agente');

  if (select company_id from chat.contact_memory where contact_id = v_contato_a)
     <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALHOU: a memória nasceu com a empresa errada';
  end if;

  -- Contato de B com a empresa de A: a política de escrita só olha a empresa
  -- da linha, e a linha estaria dizendo a verdade. Quem recusa é a chave
  -- composta.
  begin
    insert into chat.contact_memory (contact_id, fato)
    values (v_contato_b, 'memória plantada de fora');
    raise exception 'FALHOU: A gravou memória num contato de B';
  exception
    when foreign_key_violation then null;
  end;

  -- E o que B sabe do contato dele, A não lê.
  if exists (select 1 from chat.contact_memory
              where company_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALHOU: A enxergou a memória de B';
  end if;

  -- O bloco do prompt é montado por função que confere a empresa sozinha.
  if chat.render_contact_memory(v_contato_a) not like '%chamada de Bia%' then
    raise exception 'FALHOU: a memória de A não chegou ao prompt de A';
  end if;

  begin
    perform chat.render_contact_memory(v_contato_b);
    raise exception 'FALHOU: A montou a memória do contato de B';
  exception
    when insufficient_privilege then null;
  end;

  -- Apagar é por linha, não por contato: quem pede para ser esquecido de uma
  -- coisa não está pedindo para sumir inteiro.
  delete from chat.contact_memory where contact_id = v_contato_a;
  if chat.render_contact_memory(v_contato_a) <> '' then
    raise exception 'FALHOU: a anotação apagada continuou no prompt';
  end if;

  raise notice 'ok: a memória do contato não atravessa empresa, e some quando apagada';
end $$;
reset role;

\echo '=== grupo e etiqueta recortam a base, e param na empresa ==='

-- Segmentar errado não dá erro: dá uma campanha para a lista errada, que é o
-- tipo de falha que só se descobre pelo telefone tocando.
--
-- Uma campanha por cenário, em vez de esvaziar a fila entre um e outro:
-- atendente não apaga destinatário, e o teste roda como atendente de propósito
-- — é assim que a tela chama a função.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
declare
  v_a     uuid := '11111111-1111-1111-1111-111111111111';
  v_canal uuid := '11111111-0000-0000-0000-0000000000c1';
  v_grupo    uuid;
  v_campanha uuid;
  v_qtd      integer;
  -- A empresa A já recebe contatos numa seção anterior deste arquivo, então o
  -- esperado dos recortes largos se calcula, não se crava. Os recortes por
  -- grupo são exatos porque o grupo é só destes quatro.
  v_esperado integer;
begin
  insert into chat.contact_groups (nome) values ('Revendedores') returning id into v_grupo;

  -- Quatro contatos: dois no grupo (um com a etiqueta), dois sem grupo.
  insert into chat.audience (company_id, name, wa_id, tags, group_id) values
    (v_a, 'Rev com etiqueta',  '5531900000001', '{recorte-teste}', v_grupo),
    (v_a, 'Rev sem etiqueta',  '5531900000002', '{}',               v_grupo),
    (v_a, 'Solto com etiqueta','5531900000003', '{recorte-teste}',  null),
    (v_a, 'Solto sem nada',    '5531900000004', '{}',               null);

  -- Grupo e etiqueta se somam com E: só o primeiro dos quatro.
  insert into chat.campaigns (company_id, channel_id, name, body)
  values (v_a, v_canal, 'Recorte 1', 'oi') returning id into v_campanha;
  v_qtd := chat.enqueue_campaign(v_campanha, '{recorte-teste}', array[v_grupo]);
  if v_qtd <> 1 then
    raise exception 'FALHOU: grupo mais etiqueta deveria pegar 1, pegou %', v_qtd;
  end if;

  -- Só o grupo: os dois do grupo.
  insert into chat.campaigns (company_id, channel_id, name, body)
  values (v_a, v_canal, 'Recorte 2', 'oi') returning id into v_campanha;
  v_qtd := chat.enqueue_campaign(v_campanha, null, array[v_grupo]);
  if v_qtd <> 2 then
    raise exception 'FALHOU: só o grupo deveria pegar 2, pegou %', v_qtd;
  end if;

  -- Só quem não tem grupo: os dois deste bloco, mais os que a empresa já tinha.
  select count(*) into v_esperado
    from chat.audience
   where company_id = v_a and is_sendable and group_id is null;

  insert into chat.campaigns (company_id, channel_id, name, body)
  values (v_a, v_canal, 'Recorte 3', 'oi') returning id into v_campanha;
  v_qtd := chat.enqueue_campaign(v_campanha, null, null, true);
  if v_qtd <> v_esperado then
    raise exception 'FALHOU: sem grupo deveria pegar %, pegou %', v_esperado, v_qtd;
  end if;

  -- Nada escolhido continua sendo a base inteira, como antes desta migration.
  select count(*) into v_esperado
    from chat.audience where company_id = v_a and is_sendable;

  insert into chat.campaigns (company_id, channel_id, name, body)
  values (v_a, v_canal, 'Recorte 4', 'oi') returning id into v_campanha;
  v_qtd := chat.enqueue_campaign(v_campanha);
  if v_qtd <> v_esperado then
    raise exception 'FALHOU: sem filtro deveria pegar a base inteira (%), pegou %', v_esperado, v_qtd;
  end if;

  -- Quem está fora da lista não entra em recorte nenhum.
  update chat.audience
     set is_sendable = false, unsendable_reason = 'manual', unsendable_at = now()
   where wa_id = '5531900000001';
  insert into chat.campaigns (company_id, channel_id, name, body)
  values (v_a, v_canal, 'Recorte 5', 'oi') returning id into v_campanha;
  v_qtd := chat.enqueue_campaign(v_campanha, null, array[v_grupo]);
  if v_qtd <> 1 then
    raise exception 'FALHOU: "não enviar" não tirou o contato do recorte, pegou %', v_qtd;
  end if;

  -- O grupo é da empresa: nem aparece para B, nem aceita contato de B.
  if exists (select 1 from chat.contact_groups where company_id <> v_a) then
    raise exception 'FALHOU: A enxergou grupo de outra empresa';
  end if;

  -- Pela tela, quem barra é a RLS, e ela barra calada: o update não encontra
  -- a linha de B, então não falha — simplesmente não muda nada. Testar o erro
  -- aqui seria testar a mensagem errada; o que importa é que B ficou intacto.
  update chat.audience set group_id = v_grupo
   where company_id = '22222222-2222-2222-2222-222222222222';

  -- Apagar o grupo devolve os contatos para "sem grupo", sem perder ninguém.
  delete from chat.contact_groups where id = v_grupo;
  if exists (select 1 from chat.audience where group_id = v_grupo) then
    raise exception 'FALHOU: sobrou contato apontando para grupo apagado';
  end if;
  if (select count(*) from chat.audience where wa_id like '55319000000%') <> 4 then
    raise exception 'FALHOU: apagar o grupo levou contato junto';
  end if;

  raise notice 'ok: grupo e etiqueta recortam com E, e o grupo é da empresa';
end $$;
reset role;

-- A RLS protege quem entra pela tela. Quem entra com chave de serviço a ignora,
-- e aí quem barra é a chave composta — a mesma ideia da memória do contato.
do $$
declare
  v_grupo uuid;
begin
  insert into chat.contact_groups (company_id, nome)
  values ('11111111-1111-1111-1111-111111111111', 'Grupo de A')
  returning id into v_grupo;

  if exists (select 1 from chat.audience
              where company_id = '22222222-2222-2222-2222-222222222222'
                and group_id is not null) then
    raise exception 'FALHOU: a RLS deixou A colocar contato de B num grupo dele';
  end if;

  begin
    update chat.audience set group_id = v_grupo
     where company_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FALHOU: sem RLS, o banco aceitou grupo de outra empresa';
  exception
    when foreign_key_violation then null;
  end;

  raise notice 'ok: nem pela tela nem pelo servidor o grupo atravessa empresa';
end $$;

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

\echo '=== encerrar conversa não atravessa empresa ==='

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  begin
    perform chat.close_conversation('22222222-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: A encerrou conversa de B';
  exception when insufficient_privilege then null;
  end;

  begin
    perform chat.reopen_conversation('22222222-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: A reabriu conversa de B';
  exception when insufficient_privilege then null;
  end;

  -- Na própria pode, e sai do modo humano junto.
  update chat.conversations set mode='human' where id='11111111-0000-0000-0000-0000000000c3';
  perform chat.close_conversation('11111111-0000-0000-0000-0000000000c3');

  if (select status::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'closed' then
    raise exception 'FALHOU: a conversa não foi encerrada';
  end if;
  if (select mode::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'bot' then
    raise exception 'FALHOU: ficou encerrada em modo humano — reabriria muda';
  end if;

  raise notice 'ok: encerrar fica na própria empresa e não deixa conversa muda';
end $$;
reset role;

\echo '=== a conversa tem um dono só ==='

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
  if (select assigned_agent_id from chat.conversations where id='11111111-0000-0000-0000-0000000000c3')
     <> '11111111-1111-1111-1111-1111111111aa' then
    raise exception 'FALHOU: quem assumiu não ficou como dono';
  end if;
  raise notice 'ok: quem assume vira dono';
end $$;

-- Agora o colega, na mesma empresa e na mesma conversa.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111a2","role":"authenticated"}';
do $$
declare v_dono uuid;
begin
  begin
    perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: dois atendentes assumiram a mesma conversa';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    perform chat.hand_back('11111111-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: devolveu ao bot a conversa de outro atendente';
  exception when sqlstate 'PT409' then null;
  end;

  -- Tomar é possível, mas deixa rastro: quem tomou, de quem, e por quê.
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3', 'cliente pediu', null, true);

  select assigned_agent_id into v_dono
    from chat.conversations where id='11111111-0000-0000-0000-0000000000c3';
  if v_dono <> '11111111-1111-1111-1111-1111111111a2' then
    raise exception 'FALHOU: assumir mesmo assim não trocou o dono';
  end if;

  if not exists (
    select 1 from chat.handoff_events
     where conversation_id = '11111111-0000-0000-0000-0000000000c3'
       and agent_id      = '11111111-1111-1111-1111-1111111111a2'
       and from_agent_id = '11111111-1111-1111-1111-1111111111aa'
       and reason = 'cliente pediu'
  ) then
    raise exception 'FALHOU: a tomada não registrou de quem foi';
  end if;

  -- Reassumir a própria não tira de ninguém, e não pode dizer que tirou.
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3', 'de novo');
  if exists (
    select 1 from chat.handoff_events
     where conversation_id = '11111111-0000-0000-0000-0000000000c3'
       and reason = 'de novo' and from_agent_id is not null
  ) then
    raise exception 'FALHOU: reassumir a própria conversa registrou dono anterior';
  end if;

  -- E o dono devolve sem precisar forçar nada.
  perform chat.hand_back('11111111-0000-0000-0000-0000000000c3');
  if (select assigned_agent_id from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: devolver ao bot não soltou a conversa';
  end if;

  raise notice 'ok: assumir é exclusivo, tomar deixa rastro, e o dono devolve';
end $$;

-- Liberar não é devolver ao bot. O cliente pediu uma pessoa e continua
-- querendo uma: a conversa volta para a fila, não para a automação.
do $$
begin
  begin
    perform chat.liberar_para_fila('11111111-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: liberou uma conversa que está com a automação';
  exception when sqlstate 'PT409' then null;
  end;

  perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
  perform chat.liberar_para_fila('11111111-0000-0000-0000-0000000000c3', 'saindo para o almoço');

  if (select assigned_agent_id from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: liberar não soltou a conversa';
  end if;
  if (select mode::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'human' then
    raise exception 'FALHOU: liberar devolveu ao bot, que é a outra ação';
  end if;
  if (select status::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'pending' then
    raise exception 'FALHOU: liberou e a conversa não ficou marcada como fila';
  end if;
  if (select aguardando_desde from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is null then
    raise exception 'FALHOU: voltou para a fila e o relógio da espera não recomeçou';
  end if;
  if not exists (
    select 1 from chat.handoff_events
     where conversation_id = '11111111-0000-0000-0000-0000000000c3'
       and from_mode = 'human' and to_mode = 'human'
       and reason = 'saindo para o almoço'
  ) then
    raise exception 'FALHOU: liberar não deixou rastro';
  end if;

  raise notice 'ok: liberar solta na fila, e não na automação';
end $$;

-- E a conversa de outro atendente só se solta com motivo, como o resto.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111a2","role":"authenticated"}';
do $$
begin
  begin
    perform chat.liberar_para_fila('11111111-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: liberou a conversa de outro atendente sem motivo';
  exception when sqlstate 'PT409' then null;
  end;

  perform chat.liberar_para_fila('11111111-0000-0000-0000-0000000000c3', 'colega saiu sem devolver', true);
  if (select assigned_agent_id from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: liberar mesmo assim não soltou a conversa';
  end if;
  if not exists (
    select 1 from chat.handoff_events
     where conversation_id = '11111111-0000-0000-0000-0000000000c3'
       and from_agent_id = '11111111-1111-1111-1111-1111111111aa'
       and reason = 'colega saiu sem devolver'
  ) then
    raise exception 'FALHOU: liberar mesmo assim não registrou de quem era';
  end if;

  -- Volta ao bot para as seções seguintes encontrarem o que esperam.
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
  perform chat.hand_back('11111111-0000-0000-0000-0000000000c3');

  raise notice 'ok: soltar a conversa de outro pede motivo e fica registrado';
end $$;

-- Direcionar é um recado, não uma entrega: a conversa continua na fila.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
  perform chat.atribuir_conversa('11111111-0000-0000-0000-0000000000c3',
                                 '11111111-1111-1111-1111-1111111111a2',
                                 'ele já falou com esse cliente');

  if (select assigned_agent_id from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: direcionar virou posse';
  end if;
  if (select atribuida_para from chat.conversations where id='11111111-0000-0000-0000-0000000000c3')
     <> '11111111-1111-1111-1111-1111111111a2' then
    raise exception 'FALHOU: o recado não ficou gravado';
  end if;
  if (select aguardando_desde from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is null then
    raise exception 'FALHOU: direcionar tirou a conversa da fila';
  end if;
  if not exists (
    select 1 from chat.handoff_events
     where conversation_id = '11111111-0000-0000-0000-0000000000c3'
       and agent_id      = '11111111-1111-1111-1111-1111111111aa'
       and para_agent_id = '11111111-1111-1111-1111-1111111111a2'
       and reason = 'ele já falou com esse cliente'
  ) then
    raise exception 'FALHOU: o direcionamento não registrou quem recebeu';
  end if;

  -- Quem assume limpa o recado: ele era da fila, e a conversa saiu dela.
  perform chat.take_over('11111111-0000-0000-0000-0000000000c3');
  if (select atribuida_para from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: assumiu e o recado da fila ficou para trás';
  end if;

  -- Fora da empresa não se direciona, nem para quem está inativo.
  perform chat.liberar_para_fila('11111111-0000-0000-0000-0000000000c3');
  begin
    perform chat.atribuir_conversa('11111111-0000-0000-0000-0000000000c3',
                                   '22222222-2222-2222-2222-2222222222bb');
    raise exception 'FALHOU: direcionou conversa para atendente de outra empresa';
  exception when others then
    if sqlstate = 'PT409' then raise; end if;
  end;

  perform chat.hand_back('11111111-0000-0000-0000-0000000000c3');

  raise notice 'ok: direcionar deixa a conversa na fila e não atravessa empresa';
end $$;
reset role;

-- O sistema não tem dono: os prazos rodam sem auth.uid() e não podem esbarrar
-- na regra de posse, senão a conversa esquecida ficaria presa para sempre.
-- `reset role` devolve o papel, mas não as claims — sem limpar, auth.uid()
-- continuaria respondendo o último agente e o teste testaria outra coisa.
set local request.jwt.claims = '';
do $$
begin
  update chat.conversations
     set mode='human', assigned_agent_id='11111111-1111-1111-1111-1111111111aa'
   where id='11111111-0000-0000-0000-0000000000c3';

  perform chat.hand_back('11111111-0000-0000-0000-0000000000c3', 'prazo');

  if (select mode::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'bot' then
    raise exception 'FALHOU: o sistema não conseguiu devolver conversa com dono';
  end if;
  raise notice 'ok: sem usuário, a posse não trava o sistema';
end $$;

\echo '=== o relógio de prazos respeita o prazo de cada empresa ==='

do $$
declare v_mexeu int;
begin
  -- Só A configura prazo. B fica sem, e não pode ser tocada.
  insert into chat.settings (company_id, key, value)
  values ('11111111-1111-1111-1111-111111111111', 'encerrar_apos_minutos', '1'::jsonb);

  update chat.conversations
     set last_message_at = now() - interval '2 hours', status = 'open'
   where company_id in ('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222');

  -- Fora do expediente o relógio não corre — é o que impede a conversa que
  -- escalou às 22h de sumir da fila antes de alguém chegar. A abre só na
  -- segunda, então enquanto o teste não roda numa segunda de manhã nada muda.
  select count(*) into v_mexeu from chat.aplicar_prazos_de_conversa();
  if (select status::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') = 'closed'
     and not chat.empresa_aberta('11111111-1111-1111-1111-111111111111') then
    raise exception 'FALHOU: o prazo correu com a empresa fechada';
  end if;

  -- Agora com a empresa aberta 24 horas, que é como toda empresa nasce.
  update chat.company_profile set horario_semana = '{}'::jsonb
   where company_id = '11111111-1111-1111-1111-111111111111';

  select count(*) into v_mexeu from chat.aplicar_prazos_de_conversa();

  if (select status::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'closed' then
    raise exception 'FALHOU: a conversa de A não foi encerrada pelo prazo dela';
  end if;
  if (select status::text from chat.conversations where id='22222222-0000-0000-0000-0000000000c3') = 'closed' then
    raise exception 'FALHOU: o prazo de A encerrou conversa de B';
  end if;

  raise notice 'ok: o prazo só corre em expediente, e só na empresa dele';
end $$;

\echo '=== o não lido é de cada um ==='

-- Uma seção anterior encerrou esta conversa, e encerrar marca como lida para a
-- equipe. Apagar a marca é o que dá a esta seção uma linha do tempo própria —
-- dentro de uma transação `now()` é o mesmo instante para tudo, e comparar
-- leitura com mensagem exigiria um relógio que não existe aqui.
delete from chat.conversation_reads
 where conversation_id = '11111111-0000-0000-0000-0000000000c3';

-- A mensagem entra pelo servidor, como na vida real: a RLS de `messages` não
-- deixa agente escrever direto, e é ela que garante isso.
insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id)
values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
        'in','text','chegou agora','contact','11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
declare v_a int;
begin
  select unread_count into v_a from chat.inbox
   where conversation_id = '11111111-0000-0000-0000-0000000000c3';
  if v_a < 1 then
    raise exception 'FALHOU: a mensagem nova não contou como não lida';
  end if;

  perform chat.mark_read('11111111-0000-0000-0000-0000000000c3');

  select unread_count into v_a from chat.inbox
   where conversation_id = '11111111-0000-0000-0000-0000000000c3';
  if v_a <> 0 then
    raise exception 'FALHOU: ler não zerou para quem leu';
  end if;
end $$;

-- O colega não leu nada, e a lista dele tem de dizer isso.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111a2","role":"authenticated"}';
do $$
declare v_a2 int;
begin
  select unread_count into v_a2 from chat.inbox
   where conversation_id = '11111111-0000-0000-0000-0000000000c3';
  if v_a2 < 1 then
    raise exception 'FALHOU: um leu e apagou o aviso do outro';
  end if;

  -- E a marca de leitura de um não é escrevível pelo outro.
  begin
    insert into chat.conversation_reads (conversation_id, agent_id, lido_ate, company_id)
    values ('11111111-0000-0000-0000-0000000000c3','11111111-1111-1111-1111-1111111111aa',
            now(),'11111111-1111-1111-1111-111111111111');
    raise exception 'FALHOU: um agente marcou como lida no lugar do outro';
  exception when insufficient_privilege or unique_violation then null;
  end;

  raise notice 'ok: cada um tem o próprio não lido';
end $$;
reset role;

\echo '=== o bot cala diante de outro robô ==='

do $$
declare v_i int; v_motivo text; v_saidas int;
begin
  -- A conversa toda é datada no passado: reativar carimba `now()`, e o marco
  -- d'água só faz sentido se houver um "antes" dele para perdoar.
  --
  -- Gente repetindo: "bom dia" três vezes, com respostas nossas no meio. Não
  -- pode calar — é o falso positivo que custaria um cliente de verdade.
  for v_i in 1..3 loop
    insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id, created_at)
    values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
            'in','text','Bom dia','contact','11111111-1111-1111-1111-111111111111',
            now() - interval '20 minutes' + make_interval(secs => v_i * 20));
    insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id, created_at)
    values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
            'out','text','Bom dia! Como posso ajudar?','bot','11111111-1111-1111-1111-111111111111',
            now() - interval '20 minutes' + make_interval(secs => v_i * 20 + 5));
  end loop;

  if (select silenciada_em from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: calou uma pessoa que só repetiu bom dia';
  end if;

  -- Agora o robô: a mesma frase, com o número do protocolo mudando, e resposta
  -- em segundos. É o que os dados de produção mostraram.
  select count(*) into v_saidas from chat.messages
   where conversation_id = '11111111-0000-0000-0000-0000000000c3' and direction = 'out';

  for v_i in 1..3 loop
    insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id, created_at)
    values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
            'out','text','Posso ajudar com aquecedores?','bot','11111111-1111-1111-1111-111111111111',
            now() - interval '10 minutes' + make_interval(secs => v_i * 20));
    insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id, created_at)
    values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
            'in','text','Seu protocolo de atendimento é: ' || (28970 + v_i),
            'contact','11111111-1111-1111-1111-111111111111',
            now() - interval '10 minutes' + make_interval(secs => v_i * 20 + 3));
  end loop;

  select silenciada_motivo into v_motivo
    from chat.conversations where id='11111111-0000-0000-0000-0000000000c3';

  if v_motivo is null then
    raise exception 'FALHOU: não reconheceu o robô do outro lado';
  end if;

  -- Calar é tudo o que se faz: nenhuma mensagem de despedida, que seria só
  -- mais uma volta no laço. As três saídas são as que este teste escreveu.
  if (select count(*) from chat.messages
       where conversation_id = '11111111-0000-0000-0000-0000000000c3'
         and direction = 'out') <> v_saidas + 3 then
    raise exception 'FALHOU: calar escreveu mensagem';
  end if;

  raise notice 'ok: cala o robô e não cala a pessoa';
end $$;

-- Reativar dá ao bot uma chance de verdade: a repetição de antes do marco
-- d'água não pode calar tudo de novo no segundo seguinte.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  perform chat.reativar_bot('11111111-0000-0000-0000-0000000000c3');
  if (select silenciada_em from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: reativar não devolveu a palavra ao bot';
  end if;

  begin
    perform chat.reativar_bot('22222222-0000-0000-0000-0000000000c3');
    raise exception 'FALHOU: A reativou o bot na conversa de B';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  -- Uma mensagem nova, sozinha, não recria o laço antigo.
  insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id, created_at)
  values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
          'in','text','Oi, quero um orçamento','contact','11111111-1111-1111-1111-111111111111',
          now() + interval '1 second');

  if (select silenciada_em from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: calou de novo pela repetição que já tinha sido perdoada';
  end if;

  raise notice 'ok: reativar dá ao bot uma chance de verdade';
end $$;

\echo '=== bloquear um número tira ele da frente de todo mundo ==='

-- Quem bloqueia é o atendente comum, não o administrador: a exigência é ser
-- agente ativo da empresa, e A2 é 'agent'.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111a2","role":"authenticated"}';
do $$
begin
  -- O contato de A está gravado como 5500000000001; bloqueia-se digitando
  -- sem o país, como gente digita.
  perform chat.bloquear_numero('00000000001', 'spam');

  if not exists (select 1 from chat.blocked_numbers
                  where company_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'FALHOU: atendente não conseguiu bloquear';
  end if;

  if (select bloqueado_em from chat.conversations
       where id='11111111-0000-0000-0000-0000000000c3') is null then
    raise exception 'FALHOU: bloqueou o número e a conversa continuou solta';
  end if;

  if exists (select 1 from chat.inbox
              where conversation_id = '11111111-0000-0000-0000-0000000000c3') then
    raise exception 'FALHOU: a conversa bloqueada continua na lista';
  end if;

  -- O bloqueio é da empresa que bloqueou. B tem um contato com o mesmo
  -- número, e ele não pode ser atingido.
  if (select bloqueado_em from chat.conversations
       where id='22222222-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: o bloqueio de A alcançou a conversa de B';
  end if;

  raise notice 'ok: atendente bloqueia, e o bloqueio para na empresa dele';
end $$;
reset role;

-- Mensagem nova de número bloqueado não ressuscita a conversa na lista.
do $$
begin
  insert into chat.messages (conversation_id, channel_id, direction, type, body, author, company_id, created_at)
  values ('11111111-0000-0000-0000-0000000000c3','11111111-0000-0000-0000-0000000000c1',
          'in','text','oi de novo','contact','11111111-1111-1111-1111-111111111111',
          now() + interval '10 seconds');

  if (select bloqueado_em from chat.conversations
       where id='11111111-0000-0000-0000-0000000000c3') is null then
    raise exception 'FALHOU: uma mensagem nova desfez o bloqueio';
  end if;

  raise notice 'ok: o bloqueado escreve e continua invisível';
end $$;

-- E o mesmo celular com o 9 da operadora é o mesmo celular.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111a2","role":"authenticated"}';
do $$
begin
  if chat.chave_de_numero('5500000000001') <> chat.chave_de_numero('550000000001') then
    raise exception 'FALHOU: o 9 da operadora virou outro número';
  end if;

  -- Desbloquear devolve a conversa à lista sem apagar nada.
  perform chat.desbloquear_numero('5500000000001');

  if exists (select 1 from chat.blocked_numbers
              where company_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'FALHOU: desbloquear não tirou o número da lista';
  end if;
  if not exists (select 1 from chat.inbox
                  where conversation_id = '11111111-0000-0000-0000-0000000000c3') then
    raise exception 'FALHOU: desbloqueou e a conversa não voltou';
  end if;
  if not exists (select 1 from chat.messages
                  where conversation_id = '11111111-0000-0000-0000-0000000000c3') then
    raise exception 'FALHOU: bloquear apagou o histórico';
  end if;

  raise notice 'ok: desbloquear devolve a conversa com o histórico inteiro';
end $$;
reset role;

\echo '=== a presença não atravessa empresa ==='

-- O canal de presença é privado, e privado no Realtime quer dizer autorizado
-- pela RLS de `realtime.messages`. Sem esta política a tabela nega tudo, e com
-- ela mal escrita cada empresa veria quem está online nas outras.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
begin
  -- No tópico da própria empresa, entra.
  perform set_config('realtime.topic', 'presenca:11111111-1111-1111-1111-111111111111', true);
  insert into realtime.messages (topic, extension, private)
  values ('presenca:11111111-1111-1111-1111-111111111111', 'presence', true);

  if not exists (select 1 from realtime.messages
                  where topic = 'presenca:11111111-1111-1111-1111-111111111111') then
    raise exception 'FALHOU: o agente não enxerga a presença da própria empresa';
  end if;

  -- No tópico de outra, não.
  perform set_config('realtime.topic', 'presenca:22222222-2222-2222-2222-222222222222', true);
  begin
    insert into realtime.messages (topic, extension, private)
    values ('presenca:22222222-2222-2222-2222-222222222222', 'presence', true);
    raise exception 'FALHOU: A entrou no canal de presença de B';
  exception when insufficient_privilege then null;
  end;

  raise notice 'ok: cada empresa só vê quem está online nela';
end $$;
reset role;

\echo '=== a fila tem prazo próprio ==='

do $$
declare v_acoes text[];
begin
  -- A seção anterior deixou A aberta 24 horas e sem encerramento útil. Os dois
  -- prazos ficam curtos de propósito: é o único jeito de provar que o de
  -- "atendente sumiu" não encosta na conversa que ninguém assumiu.
  update chat.settings set value = '0'::jsonb
   where company_id = '11111111-1111-1111-1111-111111111111'
     and key = 'encerrar_apos_minutos';
  insert into chat.settings (company_id, key, value) values
   ('11111111-1111-1111-1111-111111111111', 'devolver_ao_bot_minutos',  '1'::jsonb),
   ('11111111-1111-1111-1111-111111111111', 'devolver_da_fila_minutos', '1'::jsonb);

  -- Na fila há duas horas, e falando agora: o prazo da fila é de espera, não
  -- de silêncio. O gatilho sai do caminho porque ele existe justamente para
  -- não deixar ninguém escrever nesse campo na mão.
  alter table chat.conversations disable trigger trg_conversations_espera;
  update chat.conversations
     set mode = 'human', assigned_agent_id = null, status = 'pending',
         last_message_at = now(),
         aguardando_desde = now() - interval '2 hours'
   where id = '11111111-0000-0000-0000-0000000000c3';
  alter table chat.conversations enable trigger trg_conversations_espera;

  select array_agg(acao) into v_acoes from chat.aplicar_prazos_de_conversa();

  if not ('fila_expirada' = any(v_acoes)) then
    raise exception 'FALHOU: o prazo da fila não devolveu quem ninguém assumiu';
  end if;
  if 'devolvida' = any(v_acoes) then
    raise exception 'FALHOU: o prazo de atendente sumiu pegou conversa sem dono';
  end if;
  if (select mode::text from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') <> 'bot' then
    raise exception 'FALHOU: a conversa não voltou ao bot';
  end if;
  if (select aguardando_desde from chat.conversations where id='11111111-0000-0000-0000-0000000000c3') is not null then
    raise exception 'FALHOU: saiu da fila e continuou marcada como esperando';
  end if;

  -- Agora com dono e parada: é o outro relógio que tem de pegar.
  update chat.conversations
     set mode = 'human', assigned_agent_id = '11111111-1111-1111-1111-1111111111aa',
         status = 'open', last_message_at = now() - interval '2 hours'
   where id = '11111111-0000-0000-0000-0000000000c3';

  select array_agg(acao) into v_acoes from chat.aplicar_prazos_de_conversa();

  if not ('devolvida' = any(v_acoes)) then
    raise exception 'FALHOU: o prazo de atendente sumiu não devolveu a conversa dele';
  end if;
  if 'fila_expirada' = any(v_acoes) then
    raise exception 'FALHOU: o prazo da fila pegou conversa que tinha dono';
  end if;

  raise notice 'ok: cada relógio pega a conversa dele';
end $$;

-- A âncora do relógio da fila. Sem ela, a conversa que escalou às 22h chega às
-- 8h com dez horas de espera e é devolvida no primeiro minuto do expediente —
-- exatamente a conversa a quem o aviso de fora do horário prometeu a manhã.
do $$
begin
  update chat.company_profile
     set horario_semana = '{"1":{"abre":"08:00","fecha":"18:00"}}'::jsonb
   where company_id = '11111111-1111-1111-1111-111111111111';

  -- A abre só na segunda. Na segunda às 22h, a última abertura é a daquela
  -- manhã; no domingo seguinte, ainda é a mesma.
  if chat.ultima_abertura('11111111-1111-1111-1111-111111111111', '2026-09-07 22:00:00-03')
     <> '2026-09-07 08:00:00-03'::timestamptz then
    raise exception 'FALHOU: a última abertura de A não é a manhã da segunda';
  end if;
  if chat.ultima_abertura('11111111-1111-1111-1111-111111111111', '2026-09-13 12:00:00-03')
     <> '2026-09-07 08:00:00-03'::timestamptz then
    raise exception 'FALHOU: no sábado a última abertura deixou de ser a segunda';
  end if;

  -- B nunca configurou grade: é aberta 24 horas, e 24 horas não tem abertura.
  if chat.ultima_abertura('22222222-2222-2222-2222-222222222222') is not null then
    raise exception 'FALHOU: empresa aberta 24h inventou uma abertura';
  end if;

  update chat.company_profile set horario_semana = '{}'::jsonb
   where company_id = '11111111-1111-1111-1111-111111111111';

  raise notice 'ok: o relógio da fila começa a contar quando a empresa abre';
end $$;

\echo '=== a tela de Empresa só alcança a própria ==='

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-1111111111aa","role":"authenticated"}';
do $$
declare v_nome text;
begin
  -- A rota consulta sem filtro por id: quem limita é a regra de acesso.
  select name into v_nome from chat.companies;
  if v_nome <> 'Empresa Fantasma A' then
    raise exception 'FALHOU: a consulta sem filtro trouxe outra empresa (%)', v_nome;
  end if;

  -- Renomear a outra não pode alcançar linha nenhuma.
  update chat.companies set name = 'Invadida' where id = '22222222-2222-2222-2222-222222222222';
  if exists (select 1 from chat.companies where name = 'Invadida') then
    raise exception 'FALHOU: A renomeou a empresa de B';
  end if;

  raise notice 'ok: a tela de Empresa não alcança a empresa de outro';
end $$;
reset role;

do $$
begin
  if (select name from chat.companies where id = '22222222-2222-2222-2222-222222222222') <> 'Empresa Fantasma B' then
    raise exception 'FALHOU: o nome de B mudou apesar da política';
  end if;
  raise notice 'ok: o nome de B ficou intacto';
end $$;

\echo '=== ajuste de uma empresa não decide pela outra ==='

-- A desliga a leitura de imagens; B nunca mexeu. Antes isto era uma linha só
-- para todo mundo, e o servidor lia a de qualquer uma.
insert into chat.settings (company_id, key, value)
values ('11111111-1111-1111-1111-111111111111', 'ler_imagens', 'false'::jsonb);

do $$
declare v_a jsonb; v_b jsonb;
begin
  select value into v_a from chat.settings
   where company_id = '11111111-1111-1111-1111-111111111111' and key = 'ler_imagens';
  select value into v_b from chat.settings
   where company_id = '22222222-2222-2222-2222-222222222222' and key = 'ler_imagens';

  if v_a <> 'false'::jsonb then
    raise exception 'FALHOU: o ajuste de A não ficou desligado';
  end if;
  if v_b is not null then
    raise exception 'FALHOU: desligar em A criou ou mudou linha em B';
  end if;

  raise notice 'ok: ajuste é por empresa, e ausência não é desligado';
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
