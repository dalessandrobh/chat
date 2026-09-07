-- =============================================================================
-- 0025 — Horário de atendimento, e o que o bot promete fora dele
-- =============================================================================
-- O bot atende 24 horas; a equipe não. Até aqui o horário era uma frase solta
-- ("Segunda a sexta de 08:00 às 18:00") que só servia para o modelo ler — e
-- com ela não dá para decidir nada: às onze da noite o bot escalava, dizia que
-- ia chamar alguém, e ninguém vinha.
--
-- Então o horário vira dado. Um intervalo por dia da semana, no fuso da
-- empresa, e três funções em cima disso: se está aberto agora, quando abre de
-- novo, e o texto para o prompt.
--
-- Duas coisas passam a depender dele:
--
--   1. A escalada fora do horário avisa quando a equipe volta, em vez de
--      deixar a pessoa esperando a noite toda.
--   2. Os prazos de conversa (devolver ao bot, encerrar) só correm com a
--      empresa aberta. Sem isso a promessa morre sozinha: às 22h a conversa
--      escala, às 22h30 o relógio devolve ao bot, sai da fila `pending`, e de
--      manhã não há o que atender.
--
-- Empresa sem horário cadastrado é 24 horas — a tela nasce vazia, e vazio não
-- pode virar "fechado para sempre".

-- -----------------------------------------------------------------------------
-- O formato
-- -----------------------------------------------------------------------------
-- {"1": {"abre": "08:00", "fecha": "18:00"}, "6": {"abre": "08:00", "fecha": "12:00"}}
--
-- Chave é o dia da semana como o Postgres conta (0 = domingo), igual ao
-- getDay() do JavaScript. Dia ausente é dia fechado. Um intervalo por dia:
-- quem fecha para o almoço continua cadastrando 08:00–18:00, porque a pausa
-- do almoço não deve fazer o bot dizer "só amanhã".

create or replace function chat.horario_semana_valido(p jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[0-6]$' then return false; end if;
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if (v->>'abre')  !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
    if (v->>'fecha') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
    -- Fechar antes de abrir não é turno da madrugada, é engano de digitação.
    if (v->>'fecha')::time <= (v->>'abre')::time then return false; end if;
  end loop;

  return true;
end;
$$;

alter table chat.company_profile
  add column if not exists horario_semana jsonb not null default '{}'::jsonb,
  add column if not exists fuso           text  not null default 'America/Sao_Paulo';

alter table chat.company_profile
  drop constraint if exists company_profile_horario_semana;
alter table chat.company_profile
  add constraint company_profile_horario_semana check (chat.horario_semana_valido(horario_semana));

comment on column chat.company_profile.horario_semana is
  'Um intervalo por dia da semana (0 = domingo). Vazio quer dizer 24 horas.';
comment on column chat.company_profile.fuso is
  'Fuso em que o horário acima é lido. É dele que sai "aberto agora".';

-- -----------------------------------------------------------------------------
-- Está aberto agora?
-- -----------------------------------------------------------------------------

create or replace function chat.empresa_aberta(
  p_company_id uuid,
  p_quando     timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  cfg   jsonb;
  tz    text;
  local timestamp;
  faixa jsonb;
begin
  select p.horario_semana, p.fuso into cfg, tz
    from chat.company_profile p
   where p.company_id = p_company_id;

  -- Sem linha de perfil, ou sem horário nenhum: 24 horas.
  if cfg is null or cfg = '{}'::jsonb then
    return true;
  end if;

  local := p_quando at time zone coalesce(nullif(btrim(tz), ''), 'America/Sao_Paulo');
  faixa := cfg -> extract(dow from local)::int::text;

  if faixa is null then
    return false;
  end if;

  return local::time >= (faixa->>'abre')::time
     and local::time <  (faixa->>'fecha')::time;
end;
$$;

comment on function chat.empresa_aberta(uuid, timestamptz) is
  'A equipe humana está em expediente neste instante. Empresa sem horário cadastrado é sempre.';

-- -----------------------------------------------------------------------------
-- E quando abre de novo?
-- -----------------------------------------------------------------------------
-- Devolve o próximo instante de abertura estritamente futuro. Uma semana de
-- busca basta: se em sete dias nenhum dia abre, é porque nenhum dia abre.

create or replace function chat.proxima_abertura(
  p_company_id uuid,
  p_quando     timestamptz default now()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  cfg    jsonb;
  tz     text;
  local  timestamp;
  d      int;
  dia    date;
  faixa  jsonb;
  quando timestamptz;
begin
  select p.horario_semana, p.fuso into cfg, tz
    from chat.company_profile p
   where p.company_id = p_company_id;

  if cfg is null or cfg = '{}'::jsonb then
    return null;
  end if;

  tz := coalesce(nullif(btrim(tz), ''), 'America/Sao_Paulo');
  local := p_quando at time zone tz;

  for d in 0..7 loop
    dia   := (local + make_interval(days => d))::date;
    faixa := cfg -> extract(dow from dia)::int::text;

    if faixa is not null then
      quando := (dia + (faixa->>'abre')::time) at time zone tz;
      if quando > p_quando then
        return quando;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

comment on function chat.proxima_abertura(uuid, timestamptz) is
  'Próxima abertura da empresa, no fuso dela. Nulo quando não há horário cadastrado.';

-- -----------------------------------------------------------------------------
-- As duas respostas numa chamada só, para o painel e para a escalada
-- -----------------------------------------------------------------------------

create or replace function chat.horario_de_atendimento(
  p_company_id uuid,
  p_quando     timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  cfg jsonb;
  tz  text;
begin
  perform chat.assert_same_company(p_company_id);

  select p.horario_semana, p.fuso into cfg, tz
    from chat.company_profile p
   where p.company_id = p_company_id;

  return jsonb_build_object(
    'aberta',      chat.empresa_aberta(p_company_id, p_quando),
    'configurado', coalesce(cfg, '{}'::jsonb) <> '{}'::jsonb,
    'proxima',     chat.proxima_abertura(p_company_id, p_quando),
    'fuso',        coalesce(nullif(btrim(tz), ''), 'America/Sao_Paulo')
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- O mesmo horário, em português, para o prompt
-- -----------------------------------------------------------------------------

create or replace function chat.horario_em_texto(p jsonb)
returns text
language sql
immutable
as $$
  select string_agg(
           dias.rotulo || ': ' ||
           coalesce((p -> dias.d::text ->> 'abre') || ' às ' || (p -> dias.d::text ->> 'fecha'),
                    'fechado'),
           E'\n' order by dias.ordem)
    from (values
      (1, 'Segunda', 1), (2, 'Terça',  2), (3, 'Quarta', 3), (4, 'Quinta', 4),
      (5, 'Sexta',   5), (6, 'Sábado', 6), (0, 'Domingo', 7)
    ) as dias(d, rotulo, ordem);
$$;

-- -----------------------------------------------------------------------------
-- Da frase solta para o dado
-- -----------------------------------------------------------------------------
-- O único horário cadastrado até aqui é "Segunda a sexta de 08:00 às 18:00".
-- Ele vira as cinco faixas correspondentes. Qualquer outro texto que exista
-- não some: vai para as observações, que continuam entrando no prompt.

update chat.company_profile
   set horario_semana = jsonb_build_object(
         '1', jsonb_build_object('abre', '08:00', 'fecha', '18:00'),
         '2', jsonb_build_object('abre', '08:00', 'fecha', '18:00'),
         '3', jsonb_build_object('abre', '08:00', 'fecha', '18:00'),
         '4', jsonb_build_object('abre', '08:00', 'fecha', '18:00'),
         '5', jsonb_build_object('abre', '08:00', 'fecha', '18:00'))
 where btrim(horario) ~* '^segunda a sexta.*08:00.*18:00$'
   and horario_semana = '{}'::jsonb;

update chat.company_profile
   set observacoes = btrim(observacoes || E'\n\nHorário: ' || btrim(horario))
 where btrim(horario) <> ''
   and horario_semana = '{}'::jsonb
   and char_length(observacoes) + char_length(horario) < 1980;

alter table chat.company_profile drop column if exists horario;

alter table chat.company_profile drop constraint if exists company_profile_tamanhos;
alter table chat.company_profile add constraint company_profile_tamanhos check (
  char_length(apresentacao)   <= 1000 and
  char_length(pode_explicar)  <= 1000 and
  char_length(nunca_dizer)    <= 1000 and
  char_length(quando_escalar) <= 1000 and
  char_length(regiao)         <=  300 and
  char_length(observacoes)    <= 2000 and
  char_length(fuso)           <=   64
);

-- -----------------------------------------------------------------------------
-- O prompt passa a receber a grade, não a frase
-- -----------------------------------------------------------------------------

create or replace function chat.render_company_profile(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  p      chat.company_profile;
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

  -- Você atende sempre; a equipe, não. O aviso de fora do horário quem
  -- escreve é o sistema, com a hora certa em mãos — o modelo não sabe que
  -- horas são, e por isso não pode ser ele a prometer.
  if p.horario_semana <> '{}'::jsonb then
    blocos := blocos || ('### Horário do atendimento humano' || E'\n'
      || chat.horario_em_texto(p.horario_semana) || E'\n'
      || 'Serve para situar o cliente quando ele perguntar. Nunca prometa a hora em que alguém vai responder.');
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

-- -----------------------------------------------------------------------------
-- Os prazos passam a correr só em expediente
-- -----------------------------------------------------------------------------
-- Mesma função do 0021, com uma condição a mais. Sem ela a promessa de que
-- "um atendente entra em contato no horário comercial" se desfaz sozinha
-- meia hora depois de feita.

create or replace function chat.aplicar_prazos_de_conversa()
-- Os nomes de saída não repetem nomes de coluna: dentro da função eles viram
-- variáveis, e `company_id` sozinho ficaria ambíguo no INSERT lá embaixo.
returns table (
  conversa_id uuid,
  empresa_id  uuid,
  empresa     text,
  acao        text
)
language plpgsql
security definer
set search_path = chat, public
as $$
begin
  return query
  with prazos as (
    select c.id as empresa_id,
           c.name as empresa_nome,
           nullif((d.value #>> '{}')::int, 0) as devolver_min,
           nullif((e.value #>> '{}')::int, 0) as encerrar_min,
           -- O relógio é de expediente. Uma conversa que escalou às 22h não
           -- pode ser devolvida ao bot às 22h30: ela foi para a fila humana
           -- justamente porque a equipe só chega de manhã, e devolver
           -- apagaria o `pending` que é o recado deixado para amanhã.
           chat.empresa_aberta(c.id) as aberta
      from chat.companies c
      left join chat.settings d
        on d.company_id = c.id and d.key = 'devolver_ao_bot_minutos'
      left join chat.settings e
        on e.company_id = c.id and e.key = 'encerrar_apos_minutos'
     where c.is_active
  ),

  -- 1. Conversa parada em atendimento humano volta para o bot.
  devolvidas as (
    update chat.conversations v
       set mode              = 'bot',
           assigned_agent_id = null,
           bot_resume_at     = null,
           -- `pending` quer dizer "esperando atendente". Devolvida ao bot, não
           -- está mais esperando ninguém — deixar assim faria a conversa
           -- seguir marcada como fila na tela, sem estar.
           status            = case when v.status = 'pending' then 'open'::chat.conversation_status
                                    else v.status end
      from prazos p
     where v.company_id = p.empresa_id
       and p.aberta
       and p.devolver_min is not null
       and v.mode = 'human'
       and v.status <> 'closed'
       and coalesce(v.last_message_at, v.updated_at)
             < now() - make_interval(mins => p.devolver_min)
    returning v.id, v.company_id, p.empresa_nome
  ),
  registro_devolucao as (
    insert into chat.handoff_events (conversation_id, from_mode, to_mode, actor, reason, company_id)
    select d.id, 'human', 'bot', 'system', 'Devolvida por inatividade', d.company_id from devolvidas d
    returning 1
  ),

  -- 2. Conversa parada há mais tempo ainda é arquivada.
  --
  -- Volta para o bot junto, mesmo que o prazo de devolução não tenha corrido:
  -- fechar uma conversa em modo humano deixaria uma armadilha — o contato
  -- escreve, o gatilho reabre, e o bot continua calado porque o modo é
  -- `human`. Ninguém responderia, e nada apareceria como erro.
  encerradas as (
    update chat.conversations v
       set status            = 'closed',
           mode              = 'bot',
           assigned_agent_id = null,
           bot_resume_at     = null
      from prazos p
     where v.company_id = p.empresa_id
       and p.aberta
       and p.encerrar_min is not null
       and v.status <> 'closed'
       and coalesce(v.last_message_at, v.updated_at)
             < now() - make_interval(mins => p.encerrar_min)
    returning v.id, v.company_id, p.empresa_nome
  )

  select d.id, d.company_id, d.empresa_nome, 'devolvida'::text from devolvidas d
  union all
  select e.id, e.company_id, e.empresa_nome, 'encerrada'::text from encerradas e;
end;
$$;
-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
-- `empresa_aberta` e `proxima_abertura` leem o perfil de qualquer empresa sem
-- conferir nada — são peças internas, chamadas por funções que já conferiram.
-- Quem entra pelo painel usa `horario_de_atendimento`, que confere.

revoke all on function chat.empresa_aberta(uuid, timestamptz)   from public, authenticated;
revoke all on function chat.proxima_abertura(uuid, timestamptz) from public, authenticated;
grant execute on function chat.empresa_aberta(uuid, timestamptz)   to service_role;
grant execute on function chat.proxima_abertura(uuid, timestamptz) to service_role;
grant execute on function chat.horario_de_atendimento(uuid, timestamptz) to authenticated, service_role;
grant execute on function chat.horario_em_texto(jsonb)    to authenticated, service_role;
grant execute on function chat.horario_semana_valido(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
