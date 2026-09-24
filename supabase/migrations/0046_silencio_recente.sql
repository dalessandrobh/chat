-- =============================================================================
-- 0046 — O aviso é sobre agora, não sobre a semana passada
-- =============================================================================
-- A 0045 procurava conversa no bot com a última fala do cliente sem resposta,
-- de qualquer data. Só que a semana muda deixou seis conversas assim, e elas
-- não serão respondidas pelo bot nunca: quem responde agora é gente, à mão.
-- Com o agente já de volta, em 23/09/2026, o aviso continuava aberto por causa
-- delas — um alarme que não desliga deixa de ser alarme.
--
-- Então a janela passa a ter começo e fim: a fala do cliente precisa ser velha
-- o bastante para o bot já ter respondido (cinco minutos) e nova o bastante
-- para ainda ser problema de agora (três horas). O que ficou para trás é
-- pendência de atendimento, e aparece no inbox como sempre apareceu.

begin;

create or replace function chat.detectar_silencio_do_agente(p_minutos integer default 5)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_corte  timestamptz := now() - make_interval(mins => p_minutos);
  -- Depois disto a conversa é assunto de quem atende, não sinal de agente fora
  -- do ar: o bot não volta atrás para responder o que envelheceu.
  v_limite timestamptz := now() - interval '3 hours';
  v_empresa record;
  v_total integer := 0;
begin
  for v_empresa in
    select cv.company_id,
           count(*) as conversas,
           (array_agg(cv.id order by cv.last_message_at desc))[1] as exemplo
      from chat.conversations cv
      join chat.channels ch on ch.id = cv.channel_id
     where cv.mode = 'bot'
       and cv.silenciada_em is null
       and ch.is_active
       and exists (
         select 1 from chat.messages m
          where m.conversation_id = cv.id
            and m.direction = 'in'
            and m.author = 'contact'
            and m.created_at < v_corte
            and m.created_at > v_limite
            and m.created_at = (
              select max(m2.created_at) from chat.messages m2
               where m2.conversation_id = cv.id
            )
       )
     group by cv.company_id
  loop
    perform chat.registrar_falha_do_agente(
      v_empresa.company_id,
      'O atendimento automático não está respondendo.',
      format('%s conversa(s) com a última mensagem do cliente sem resposta há mais de %s minutos.',
             v_empresa.conversas, p_minutos),
      v_empresa.exemplo
    );
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

comment on function chat.detectar_silencio_do_agente(integer) is
  'Abre o aviso quando há conversa no bot, das últimas três horas, com a última fala do cliente sem resposta.';

commit;

notify pgrst, 'reload schema';
