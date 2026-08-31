-- =============================================================================
-- 0011 — Mensagem picotada: um turno do bot por rajada, não por mensagem
-- =============================================================================
-- No WhatsApp ninguém escreve um parágrafo. Escreve "oi", "queria saber",
-- "sobre aquecedor solar" — três webhooks em cinco segundos. Sem isto o bot
-- responde três vezes, cada resposta baseada em meia pergunta, e ainda se
-- atropela: a segunda chega antes de a primeira ter sido lida.
--
-- A ideia é uma janela deslizante. Cada mensagem nova empurra o prazo para
-- frente; quando o cliente para de digitar, a janela vence e o agente roda uma
-- vez só. O teto existe para quem nunca para: passou dele, responde assim
-- mesmo — esperar indefinidamente seria a mesma coisa que não responder.
--
-- A rajada inteira já está em chat.messages, então a linha aqui não guarda
-- texto: guarda só o último evento, que é o que o n8n precisa receber.

create table if not exists chat.message_batches (
  conversation_id uuid primary key references chat.conversations(id) on delete cascade,
  due_at          timestamptz not null,
  first_at        timestamptz not null default now(),
  mensagens       int         not null default 1,
  payload         jsonb       not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_message_batches_due on chat.message_batches (due_at);

-- -----------------------------------------------------------------------------
-- Enfileirar
-- -----------------------------------------------------------------------------
-- Devolve o instante em que o turno vai rodar. Duas mensagens chegando ao
-- mesmo tempo não podem virar dois turnos, então a janela é calculada dentro
-- do próprio upsert.
--
-- O `text` do payload vai se emendando a cada mensagem. É ele que o agente
-- recebe como a fala do cliente, e o cliente falou as três linhas — mandar só
-- a última faria o bot responder "sobre aquecedor solar" sem o "queria saber".

create or replace function chat.enqueue_bot_turn(
  p_conversation_id uuid,
  p_payload         jsonb,
  p_janela          interval default '8 seconds',
  p_teto            interval default '40 seconds'
)
returns timestamptz
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_due timestamptz;
begin
  insert into chat.message_batches (conversation_id, due_at, first_at, payload)
  values (p_conversation_id, now() + p_janela, now(), p_payload)
  on conflict (conversation_id) do update
    set due_at    = least(now() + p_janela, message_batches.first_at + p_teto),
        payload   = jsonb_set(
                      excluded.payload,
                      '{text}',
                      to_jsonb(
                        btrim(
                          coalesce(message_batches.payload ->> 'text', '') || E'\n' ||
                          coalesce(excluded.payload ->> 'text', '')
                        )
                      )
                    ),
        mensagens = message_batches.mensagens + 1
  returning due_at into v_due;

  return v_due;
end;
$$;

-- -----------------------------------------------------------------------------
-- Recolher o que venceu
-- -----------------------------------------------------------------------------
-- `delete ... returning` porque recolher é consumir: a linha sai da fila no
-- mesmo comando que a entrega. `skip locked` para o dia em que houver mais de
-- um relógio rodando — dois turnos para a mesma conversa seriam duas respostas
-- para a mesma pergunta.

create or replace function chat.claim_due_bot_turns(p_limite int default 20)
returns table (conversation_id uuid, payload jsonb, mensagens int)
language sql
security definer
set search_path = chat, public
as $$
  delete from chat.message_batches b
  where b.conversation_id in (
    select c.conversation_id
      from chat.message_batches c
     where c.due_at <= now()
     order by c.due_at
     limit p_limite
     for update skip locked
  )
  returning b.conversation_id, b.payload, b.mensagens;
$$;

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
-- Fila interna: ninguém no painel precisa ver, e RLS sem política nenhuma nega
-- todo mundo que não seja a service_role.

alter table chat.message_batches enable row level security;

grant all on chat.message_batches to service_role;
grant execute on function chat.enqueue_bot_turn(uuid, jsonb, interval, interval) to service_role;
grant execute on function chat.claim_due_bot_turns(int) to service_role;
