-- O bot ganha nome, e o número repetido para de entrar.
--
-- Duas coisas pequenas e sem relação, juntas porque nasceram do mesmo uso da
-- tela num dia só.
--
-- **O nome.** No painel toda fala da automação aparecia sob a etiqueta "BOT",
-- cravada no código. Quem opera dá um nome ao atendimento — Eddy, Sol, Ana — e
-- ler "BOT" no meio da conversa é ler o nome interno do sistema num lugar onde
-- se esperava o nome de quem atende. Agora é campo da empresa.
--
-- Nomear é também dizer ao modelo: um bot chamado Eddy que não sabe que se
-- chama Eddy responde "sou o atendimento automático" quando perguntam o nome
-- dele. O nome entra no perfil que vai ao prompt.
--
-- **O número repetido.** `audience` já era única por `(company_id, wa_id)`, mas
-- pelo texto exato — e o WhatsApp guarda o mesmo celular como 553598059605 e
-- 5535998059605, conforme a época e o aparelho. As duas formas passavam pela
-- unicidade e viravam dois contatos, que recebem a mesma campanha duas vezes.
--
-- A chave canônica já existia para o bloqueio de número (`chave_de_numero`, do
-- 0033): país + DDD + os oito dígitos finais. Aqui ela vira coluna gerada, e é
-- por ela que a importação passa a comparar.

begin;

-- -----------------------------------------------------------------------------
-- O nome do bot
-- -----------------------------------------------------------------------------

alter table chat.company_profile
  add column if not exists nome_do_bot text not null default '';

comment on column chat.company_profile.nome_do_bot is
  'Como a automação se chama: etiqueta no painel e nome que o modelo usa. Vazio é "bot".';

alter table chat.company_profile drop constraint if exists company_profile_tamanhos;
alter table chat.company_profile add constraint company_profile_tamanhos check (
  char_length(apresentacao)   <= 1000 and
  char_length(pode_explicar)  <= 1000 and
  char_length(nunca_dizer)    <= 1000 and
  char_length(quando_escalar) <= 1000 and
  char_length(regiao)         <=  300 and
  char_length(observacoes)    <= 2000 and
  char_length(fuso)           <=   64 and
  char_length(nome_do_bot)    <=   40
);

-- -----------------------------------------------------------------------------
-- O nome entra no prompt
-- -----------------------------------------------------------------------------
-- Mesma função do 0034, com o bloco do nome na frente de tudo. Empresa sem
-- nome cadastrado não ganha bloco nenhum — e o modelo segue como sempre foi,
-- sem nome, dizendo que é um atendimento automático quando perguntam.

CREATE OR REPLACE FUNCTION chat.render_company_profile(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'chat', 'public'
AS $function$
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

  -- Primeiro de tudo, porque é como você é chamado. Vem antes até da
  -- apresentação da empresa: a pessoa cumprimenta pelo nome antes de perguntar
  -- qualquer coisa, e responder "sou o atendimento automático" a quem chamou
  -- por "Eddy" é começar negando o próprio nome.
  if btrim(p.nome_do_bot) <> '' then
    blocos := blocos || ('### Seu nome' || E'\n'
      || 'Você se chama ' || btrim(p.nome_do_bot) || '. Apresente-se assim quando fizer '
      || 'sentido, e responda por esse nome quando chamarem por ele. Continua valendo o '
      || 'que está em Honestidade: perguntando se você é uma pessoa ou um robô, a resposta '
      || 'é que é um atendimento automático — ter nome não é ser gente.');
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

  -- Você atende sempre; a equipe, não.
  if p.horario_semana <> '{}'::jsonb then
    blocos := blocos || ('### Horário da equipe humana' || E'\n'
      || chat.horario_em_texto(p.horario_semana) || E'\n'
      || 'É o horário das pessoas, não o seu: você atende as vinte e quatro horas, todos os dias. '
      || 'Fora dele, siga atendendo igual — nunca diga que está fechado nem peça para voltar depois. '
      || 'A grade serve para situar quem perguntar por uma pessoa, e o aviso de quando a equipe volta é o sistema que acrescenta.');
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
$function$;

-- -----------------------------------------------------------------------------
-- A chave canônica do número na base de envio
-- -----------------------------------------------------------------------------
-- Coluna gerada, como em `blocked_numbers`: o 9 que a operadora acrescentou não
-- é uma diferença de número, e comparar pelo texto cru deixa o mesmo celular
-- entrar duas vezes e receber a mesma campanha duas vezes.
--
-- Índice comum, e não único, de propósito. Esta base já tem um par repetido
-- de antes — 553598059605 e 5535998059605, com nomes diferentes —, e um índice
-- único não seria criado enquanto ele existir. Escolher qual dos dois apagar é
-- decisão de quem conhece os contatos, não desta migration. A prevenção do
-- repetido novo é feita na importação, que passa a comparar por esta coluna.

alter table chat.audience
  add column if not exists chave text
    generated always as (chat.chave_de_numero(wa_id)) stored;

comment on column chat.audience.chave is
  'O número em forma comparável: país + DDD + oito dígitos. É por ela que a importação vê repetido.';

create index if not exists idx_audience_chave on chat.audience (company_id, chave);

/**
 * Quais destes números já estão na base, pela chave canônica.
 *
 * Existe para a importação perguntar uma vez por lote, em vez de uma consulta
 * por linha: planilha de cinco mil vira cinco mil idas ao banco, e o navegador
 * desiste antes do fim.
 */
create or replace function chat.numeros_ja_na_base(p_wa_ids text[])
returns table (wa_id text, chave text)
language sql
stable
security definer
set search_path = chat, public
as $$
  select a.wa_id, a.chave
    from chat.audience a
   where a.company_id = chat.current_company()
     and a.chave = any (select chat.chave_de_numero(x) from unnest(p_wa_ids) x);
$$;

comment on function chat.numeros_ja_na_base(text[]) is
  'Os números do lote que já existem na base da empresa, comparados pela chave canônica.';

revoke all on function chat.numeros_ja_na_base(text[]) from public;
grant execute on function chat.numeros_ja_na_base(text[]) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
