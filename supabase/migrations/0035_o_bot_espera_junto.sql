-- O bot espera junto.
--
-- Escalar às onze da noite deixava a conversa em `human`/`pending`, e os dois
-- webhooks só acionam a automação em modo `bot`. O relógio que devolveria a
-- conversa ao bot só corre em expediente, de propósito — o `pending` é o
-- recado deixado para a manhã. Somando as três coisas: o cliente ouvia "um
-- atendente entra em contato amanhã às 08:00" e, na pergunta seguinte, ouvia
-- silêncio. Nove horas de silêncio, inclusive para o que a base responde.
--
-- O próprio prompt promete o contrário: "escalar não fecha a conversa; se o
-- cliente voltar a falar, responda o que a base permitir". Até aqui era uma
-- promessa que o roteamento não deixava cumprir.
--
-- Então a fila fora do expediente passa a ser um estado em que o bot fala. Não
-- é voltar atrás na escalada: a conversa continua `human`, continua `pending`,
-- continua contando espera e continua aparecendo na fila de manhã. O que muda
-- é quem responde enquanto não há ninguém para responder.
--
-- Nada disso vale com a empresa aberta: aí a conversa está esperando gente de
-- verdade, e o bot falar por cima seria desfazer o que o cliente pediu.

begin;

-- `p_quando` existe pelo mesmo motivo que existe em `empresa_aberta`: sem ele
-- o teste da regra dependeria da hora em que alguém resolve rodá-lo.
create or replace function chat.fila_fora_do_expediente(
  p_conversation_id uuid,
  p_quando          timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  v_mode    chat.conversation_mode;
  v_dono    uuid;
  v_status  chat.conversation_status;
  v_empresa uuid;
begin
  select c.mode, c.assigned_agent_id, c.status, c.company_id
    into v_mode, v_dono, v_status, v_empresa
    from chat.conversations c
   where c.id = p_conversation_id;

  if not found then
    return false;
  end if;

  -- Em modo bot quem decide é o caminho de sempre; esta função responde só
  -- pelo caso novo, e responder "sim" aqui embaralharia as duas perguntas.
  if v_mode <> 'human' then
    return false;
  end if;

  -- Com dono, nunca. A trava do handoff é o que impede o bot de falar por
  -- cima de um atendente, e ela não tem exceção de horário: quem assumiu às
  -- dez da noite assumiu.
  if v_dono is not null then
    return false;
  end if;

  -- Conversa arquivada não está esperando nada.
  if v_status = 'closed' then
    return false;
  end if;

  return not chat.empresa_aberta(v_empresa, p_quando);
end;
$$;

comment on function chat.fila_fora_do_expediente(uuid, timestamptz) is
  'A conversa espera na fila humana, sem dono, e a equipe só volta no próximo expediente. É quando o bot segue atendendo mesmo tendo escalado.';

-- Peça interna do servidor, como `empresa_aberta`: quem entra pelo painel não
-- decide quem fala com o cliente.
revoke all on function chat.fila_fora_do_expediente(uuid, timestamptz) from public, authenticated;
grant execute on function chat.fila_fora_do_expediente(uuid, timestamptz) to service_role;

commit;

notify pgrst, 'reload schema';
