-- =============================================================================
-- 0024 — Diretrizes do agente por empresa
-- =============================================================================
-- O que o agente sabe já era por empresa (chat.knowledge). Como ele se
-- comporta não era: tom, o que nunca dizer, quando chamar alguém e as
-- perguntas da qualificação viviam no prompt do n8n e no código do painel —
-- escritos para uma revendedora de aquecedor solar. Numa clínica o mesmo bot
-- perguntaria quantas pessoas usam o chuveiro, com convicção.
--
-- A separação passa a ser em três camadas:
--
--   1. regras da plataforma — fixas, no prompt do n8n. Não inventar, não
--      afirmar o que não está na base, escalar em vez de chutar, terminar
--      toda rodada falando. Isso é engenharia, não negócio: a empresa não
--      edita, e por isso não há N variantes para depurar;
--   2. perfil da empresa — esta migration. Campos delimitados, não um prompt
--      em branco: quem escreve o próprio prompt apaga sem querer as regras
--      que impedem alucinação;
--   3. base de conhecimento — chat.knowledge, que já existia.
--
-- A fila de qualificação vira dado pelo mesmo motivo: é ela que faz o bot
-- perguntar "quantas pessoas usam o chuveiro" numa empresa e "qual o modelo
-- do carro" na outra.

-- -----------------------------------------------------------------------------
-- Perfil da empresa
-- -----------------------------------------------------------------------------
-- Uma linha por empresa, e a chave primária é a própria empresa: não existe
-- versão, histórico nem rascunho. O perfil é como o bot está atendendo agora.

create table if not exists chat.company_profile (
  company_id   uuid primary key references chat.companies(id) on delete cascade,
  /** Quem é a empresa, em duas linhas. Vai no alto do prompt. */
  apresentacao text not null default '',
  /** Como falar. Vira frase no prompt — o modelo não sabe o que fazer com um enum. */
  tom          text not null default 'neutro',
  /** Assuntos gerais do setor que o bot pode explicar sem estar na base. */
  pode_explicar text not null default '',
  /** O que nunca dizer, mesmo sabendo. Preço costuma morar aqui. */
  nunca_dizer  text not null default '',
  /** Gatilhos de escalonamento além dos da plataforma. */
  quando_escalar text not null default '',
  /** Horário de atendimento humano e região atendida, como texto livre curto. */
  horario      text not null default '',
  regiao       text not null default '',
  /**
   * Campo livre, com teto. É a válvula de escape para o que não coube nos
   * campos acima — e entra no prompt marcado como preferência da empresa,
   * abaixo das regras da plataforma, nunca acima.
   */
  observacoes  text not null default '',
  updated_by   uuid references chat.agents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint company_profile_tom check (tom in ('informal', 'neutro', 'formal')),
  constraint company_profile_tamanhos check (
    char_length(apresentacao)   <= 1000 and
    char_length(pode_explicar)  <= 1000 and
    char_length(nunca_dizer)    <= 1000 and
    char_length(quando_escalar) <= 1000 and
    char_length(horario)        <= 200  and
    char_length(regiao)         <= 300  and
    char_length(observacoes)    <= 2000
  )
);

comment on table chat.company_profile is
  'Diretrizes de atendimento da empresa. Camada 2: entra no prompt do agente abaixo das regras da plataforma.';

drop trigger if exists trg_company_profile_touch on chat.company_profile;
create trigger trg_company_profile_touch before update on chat.company_profile
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- A fila de qualificação
-- -----------------------------------------------------------------------------
-- Antes eram quatro campos cravados em TypeScript. Agora são linhas: cada
-- empresa pergunta o que precisa saber antes de um vendedor assumir.
--
-- A chave é o nome do dado dentro de `contacts.metadata.qualificacao`, então
-- ela não pode colidir com as três chaves de controle que moram no mesmo
-- objeto — nem mudar depois, sob pena de o que já foi respondido sumir da
-- fila e ser perguntado de novo.

create table if not exists chat.qualification_fields (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references chat.companies(id) on delete cascade,
  chave        text not null,
  /** Como a pergunta chega ao prompt: "em que cidade o aquecedor vai ser instalado". */
  pergunta     text not null,
  /** `numero` faz a rota recusar "umas quatro" — texto onde se espera conta é dado sujo. */
  tipo         text not null default 'texto',
  position     integer not null default 0,
  is_active    boolean not null default true,
  /**
   * Pergunta que só faz sentido depois de outra: quantas pessoas usam o
   * chuveiro só se perguntou para que é o aquecedor e a resposta foi casa.
   * `depende_valor` é uma expressão regular testada sem acento e sem caixa —
   * o cliente escreve "residência", "residencia" e "minha casa".
   */
  depende_de    text,
  depende_valor text,
  updated_by   uuid references chat.agents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, chave),
  constraint qualification_fields_chave check (chave ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- As três chaves de controle do mesmo objeto JSON. Um campo chamado
  -- `tentativas` sobrescreveria o contador que impede a repetição.
  constraint qualification_fields_reservada check (
    chave not in ('dispensados', 'tentativas', 'atualizado_em')
  ),
  constraint qualification_fields_tipo check (tipo in ('texto', 'numero')),
  constraint qualification_fields_pergunta check (char_length(pergunta) between 3 and 200),
  constraint qualification_fields_dependencia check (
    (depende_de is null and depende_valor is null) or
    (depende_de is not null and depende_valor is not null)
  )
);

comment on table chat.qualification_fields is
  'O que a equipe precisa saber antes de assumir a conversa, por empresa. As respostas ficam em contacts.metadata.qualificacao, na chave `chave`.';
comment on column chat.qualification_fields.chave is
  'Nome do dado em contacts.metadata.qualificacao. Mudar depois de cadastrado faz o que já foi respondido voltar para a fila.';

create index if not exists idx_qualification_fields_ordem
  on chat.qualification_fields (company_id, position, created_at) where is_active;

drop trigger if exists trg_qualification_fields_touch on chat.qualification_fields;
create trigger trg_qualification_fields_touch before update on chat.qualification_fields
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Montar o texto no banco
-- -----------------------------------------------------------------------------
-- Mesma escolha do render_knowledge: o painel mostra a conferência e o agente
-- recebe o prompt a partir da mesma função. Montar nos dois lugares é
-- garantir que um dia divirjam sem ninguém perceber.

create or replace function chat.render_company_profile(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  p     chat.company_profile;
  blocos text[] := '{}';
begin
  -- A função é SECURITY DEFINER, então ela mesma confere a empresa: sem isto
  -- qualquer pessoa logada montaria o perfil de outra passando o id.
  perform chat.assert_same_company(p_company_id);

  select * into p from chat.company_profile where company_id = p_company_id;
  if not found then
    return '';
  end if;

  if btrim(p.apresentacao) <> '' then
    blocos := blocos || ('### Sobre a empresa' || E'\n' || btrim(p.apresentacao));
  end if;

  -- O tom vira instrução, não rótulo: "formal" sozinho não diz ao modelo o
  -- que fazer com a próxima frase.
  blocos := blocos || ('### Tom' || E'\n' || case p.tom
    when 'informal' then 'Informal e próximo, como quem conhece o cliente. Pode usar emoji, com parcimônia.'
    when 'formal'   then 'Formal e respeitoso. Trate por senhor ou senhora, e não use emoji nem gíria.'
    else 'Cordial e direto, sem formalidade excessiva e sem intimidade forçada. Emoji só quando somar.'
  end);

  if btrim(p.pode_explicar) <> '' then
    blocos := blocos || ('### Pode explicar por conta própria' || E'\n' || btrim(p.pode_explicar)
      || E'\n' || 'Isso é conhecimento geral do setor. Continua valendo: número, modelo, valor e promessa só se estiverem na base.');
  end if;

  if btrim(p.regiao) <> '' then
    blocos := blocos || ('### Região atendida' || E'\n' || btrim(p.regiao));
  end if;

  if btrim(p.horario) <> '' then
    blocos := blocos || ('### Horário do atendimento humano' || E'\n' || btrim(p.horario)
      || E'\n' || 'Serve para situar o cliente. Nunca prometa a hora em que alguém vai responder.');
  end if;

  if btrim(p.nunca_dizer) <> '' then
    blocos := blocos || ('### Nunca diga' || E'\n' || btrim(p.nunca_dizer));
  end if;

  if btrim(p.quando_escalar) <> '' then
    blocos := blocos || ('### Chame uma pessoa também quando' || E'\n' || btrim(p.quando_escalar));
  end if;

  if btrim(p.observacoes) <> '' then
    blocos := blocos || ('### Outras preferências desta empresa' || E'\n' || btrim(p.observacoes));
  end if;

  return array_to_string(blocos, E'\n\n');
end;
$$;

comment on function chat.render_company_profile(uuid) is
  'Perfil da empresa em markdown, do jeito que entra no prompt do agente.';

-- -----------------------------------------------------------------------------
-- Empresa nova nasce com o que perguntar
-- -----------------------------------------------------------------------------
-- Sem isto a fila da empresa recém-criada é vazia, o agente não pergunta
-- nada e escala na primeira mensagem — o comportamento correto para uma fila
-- vazia, e péssimo como primeira impressão do produto.

create or replace function chat.seed_qualification(p_company_id uuid)
returns void
language sql
security definer
set search_path = chat, public
as $$
  insert into chat.qualification_fields (company_id, chave, pergunta, tipo, position)
  values
    (p_company_id, 'nome',      'o nome da pessoa',              'texto', 10),
    (p_company_id, 'interesse', 'o que a pessoa está procurando', 'texto', 20)
  on conflict (company_id, chave) do nothing;
$$;

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

  -- O perfil nasce em branco e a fila nasce com o mínimo. Os dois são
  -- editáveis na tela Agente antes de o primeiro cliente escrever.
  insert into chat.company_profile (company_id) values (v_id)
    on conflict (company_id) do nothing;
  perform chat.seed_qualification(v_id);

  return v_id;
end;
$$;

grant execute on function chat.create_company(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
-- Mesma régua da base de conhecimento: todo mundo lê, gestor e administrador
-- mudam. Quem decide o que o bot diz decide como ele diz.

alter table chat.company_profile      enable row level security;
alter table chat.qualification_fields enable row level security;

grant select on chat.company_profile      to authenticated;
grant select on chat.qualification_fields to authenticated;
grant all    on chat.company_profile      to service_role;
grant all    on chat.qualification_fields to service_role;
grant insert, update, delete on chat.company_profile      to authenticated;
grant insert, update, delete on chat.qualification_fields to authenticated;

drop policy if exists company_profile_select on chat.company_profile;
create policy company_profile_select on chat.company_profile
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists company_profile_write on chat.company_profile;
create policy company_profile_write on chat.company_profile
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

drop policy if exists qualification_fields_select on chat.qualification_fields;
create policy qualification_fields_select on chat.qualification_fields
  for select to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company());

drop policy if exists qualification_fields_write on chat.qualification_fields;
create policy qualification_fields_write on chat.qualification_fields
  for all to authenticated
  using (chat.is_manager() and company_id = chat.current_company())
  with check (chat.is_manager() and company_id = chat.current_company());

grant execute on function chat.render_company_profile(uuid) to authenticated, service_role;
grant execute on function chat.seed_qualification(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- O que já existe continua igual
-- -----------------------------------------------------------------------------
-- A Eco Aquecedores está atendendo agora com as quatro perguntas que moravam
-- no código e com as regras que moravam no prompt. Elas viram linhas aqui,
-- com o mesmo texto — a migration não pode mudar o comportamento de quem já
-- está em produção.

do $$
declare
  v_id uuid;
begin
  select id into v_id from chat.companies where slug = 'eco-aquecedores';
  if v_id is null then
    return;
  end if;

  insert into chat.company_profile (
    company_id, apresentacao, tom, pode_explicar, nunca_dizer, quando_escalar, observacoes
  )
  values (
    v_id,
    'Revendedora de aquecimento solar. Atende quem quer aquecer a água de casa, de piscina ou de uma empresa.',
    'neutro',
    'Como aquecimento solar funciona em termos gerais: coletor, reservatório, apoio elétrico, o que muda no inverno.',
    'Preço, prazo, condição de pagamento e disponibilidade que não estejam escritos na base. Inventar um valor e o cliente descobrir depois que é outro custa mais caro que esperar dez minutos por uma pessoa.',
    'Perguntarem preço, prazo, pagamento ou disponibilidade que não esteja na base.',
    'Havendo tabela de dimensionamento na base, indicar o modelo é ler a tabela, não estimar: com o uso e o número de pessoas em mãos, diga o modelo e a conta que usou — banhos por dia — para a pessoa poder corrigir. O preço continua fora.'
  )
  on conflict (company_id) do nothing;

  insert into chat.qualification_fields
    (company_id, chave, pergunta, tipo, position, depende_de, depende_valor)
  values
    (v_id, 'nome',    'o nome da pessoa',                              'texto',  10, null, null),
    (v_id, 'cidade',  'em que cidade o aquecedor vai ser instalado',   'texto',  20, null, null),
    (v_id, 'uso',     'se é para casa, piscina ou empresa',            'texto',  30, null, null),
    -- Piscina e empresa se dimensionam por outra conta: a pergunta só existe
    -- em residência.
    (v_id, 'pessoas', 'quantas pessoas usam o chuveiro',               'numero', 40, 'uso', 'cas[ae]|residenc')
  on conflict (company_id, chave) do nothing;
end;
$$;

-- Toda empresa que já existe ganha a linha de perfil e, se ainda não tiver
-- nenhuma pergunta, a fila mínima. Antes desta migration a fila era a mesma
-- para todas — a de aquecedor solar. Deixá-las com fila vazia faria o bot
-- delas escalar na primeira mensagem.
insert into chat.company_profile (company_id)
select id from chat.companies
on conflict (company_id) do nothing;

do $$
declare
  v_id uuid;
begin
  for v_id in
    select c.id from chat.companies c
     where not exists (select 1 from chat.qualification_fields q where q.company_id = c.id)
  loop
    perform chat.seed_qualification(v_id);
  end loop;
end;
$$;
