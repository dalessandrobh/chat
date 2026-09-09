-- O horário é da equipe, não do bot.
--
-- A tela do Agente já promete: "O bot atende sempre. Fora deste horário, ao
-- chamar um atendente ele avisa o cliente de quando a equipe volta." O modelo
-- nunca leu essa promessa. Ele recebia a grade sob o título "Horário do
-- atendimento humano" e mais nada — e às onze da noite é perfeitamente capaz
-- de concluir que a empresa está fechada e mandar o cliente voltar amanhã,
-- que é o contrário do combinado.
--
-- Semana em branco continua querendo dizer 24 horas para a equipe também:
-- nesse caso o bloco inteiro não é escrito, e não há horário nenhum no prompt.

begin;

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
  --
  -- Uma grade solta debaixo de um título não diz de quem ela é. O modelo lia
  -- "Segunda a sexta, 08:00 às 18:00" e às onze da noite concluía o que
  -- qualquer um concluiria: que estava fechado. A frase abaixo existe para
  -- desfazer isso — o horário é das pessoas, e o bot não tem horário.
  --
  -- O aviso de quando a equipe volta quem escreve é o sistema, com a hora
  -- certa em mãos: o modelo não sabe que horas são, e por isso não pode ser
  -- ele a prometer.
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

commit;
