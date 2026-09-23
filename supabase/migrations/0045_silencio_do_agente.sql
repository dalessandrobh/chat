-- =============================================================================
-- 0045 — Descobrir o silêncio do agente sem depender do n8n
-- =============================================================================
-- A 0044 deu ao painel onde registrar a falha, e o workflow ganhou um ramo de
-- erro para contá-la. Só que o erro que derrubou o bot por uma semana nasce no
-- nó **Claude**, que é sub-nó do Agente: a execução aborta ali, e a saída de
-- erro do Agente nunca chega a ser tomada. Testado em 23/09/2026 — a execução
-- 314 morreu no mesmo lugar que a 313, sem passar pelo aviso.
--
-- Então o painel passa a reparar sozinho no silêncio, olhando o que ele já
-- sabe: conversa no bot, canal ativo, última fala é do cliente, e nada saiu
-- desde então. Isso não depende do n8n estar de pé, nem de qual nó quebrou —
-- pega crédito acabado, credencial recusada e workflow fora do ar do mesmo
-- jeito.

begin;

create or replace function chat.detectar_silencio_do_agente(p_minutos integer default 5)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_corte timestamptz := now() - make_interval(mins => p_minutos);
  v_empresa record;
  v_total integer := 0;
begin
  for v_empresa in
    select cv.company_id,
           count(*)      as conversas,
           (array_agg(cv.id order by cv.last_message_at desc))[1] as exemplo
      from chat.conversations cv
      join chat.channels ch on ch.id = cv.channel_id
     where cv.mode = 'bot'
       and cv.silenciada_em is null
       and ch.is_active
       -- A última mensagem da conversa é do cliente, e já passou do corte.
       and exists (
         select 1 from chat.messages m
          where m.conversation_id = cv.id
            and m.direction = 'in'
            and m.author = 'contact'
            and m.created_at < v_corte
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
  'Abre o aviso quando há conversa no bot com a última fala do cliente sem resposta. Não depende do n8n.';

revoke all on function chat.detectar_silencio_do_agente(integer) from public;
grant execute on function chat.detectar_silencio_do_agente(integer) to service_role;

commit;

notify pgrst, 'reload schema';
