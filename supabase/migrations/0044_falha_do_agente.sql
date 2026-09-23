-- =============================================================================
-- 0044 — Quando o agente falha, o painel conta
-- =============================================================================
-- Entre 16/09 e 23/09/2026 o bot ficou mudo: a chamada ao Claude voltava
-- `Your credit balance is too low`, o workflow do n8n morria no nó do Agente, e
-- o painel não tinha como saber. O webhook devolve 200 antes de a resposta
-- existir, então do lado de cá a conversa apenas ficava "Aguardando" — 66
-- execuções seguidas, 32 conversas, 6 delas sem resposta nenhuma até alguém
-- reparar na falta.
--
-- A falha agora tem onde ser registrada, e o aviso fica de pé até o agente
-- voltar a responder: uma linha aberta por empresa, fechada pelo primeiro envio
-- do bot que der certo.
--
-- Só administrador vê. Quem atende não pode fazer nada a respeito, e o aviso
-- ocuparia a tela de quem está no meio de uma conversa.

begin;

create table if not exists chat.agent_failures (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references chat.companies(id) on delete cascade,
  -- Onde apareceu. Serve para abrir a conversa que ficou sem resposta.
  conversation_id uuid references chat.conversations(id) on delete set null,
  motivo          text not null,
  -- O texto cru do provedor. É o que diz se é crédito, credencial ou timeout.
  detalhe         text,
  ocorrencias     integer not null default 1,
  primeira_em     timestamptz not null default now(),
  ultima_em       timestamptz not null default now(),
  resolvida_em    timestamptz
);

comment on table chat.agent_failures is
  'Falhas do agente do n8n. Uma linha aberta por empresa; fecha quando o bot volta a responder.';

-- Uma aberta por empresa: o aviso é sobre o estado, não sobre cada tentativa.
-- As repetições viram contador na mesma linha.
create unique index if not exists idx_agent_failures_aberta
  on chat.agent_failures (company_id) where resolvida_em is null;

alter table chat.agent_failures enable row level security;

drop policy if exists agent_failures_select on chat.agent_failures;
create policy agent_failures_select on chat.agent_failures
  for select to authenticated
  using (chat.is_admin() and company_id = chat.current_company());

grant select on chat.agent_failures to authenticated;
grant all    on chat.agent_failures to service_role;

-- -----------------------------------------------------------------------------
-- Registrar e resolver
-- -----------------------------------------------------------------------------

create or replace function chat.registrar_falha_do_agente(
  p_company_id      uuid,
  p_motivo          text,
  p_detalhe         text default null,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_id uuid;
begin
  insert into chat.agent_failures (company_id, conversation_id, motivo, detalhe)
  values (p_company_id, p_conversation_id, p_motivo, p_detalhe)
  on conflict (company_id) where resolvida_em is null do update
    set ocorrencias     = chat.agent_failures.ocorrencias + 1,
        ultima_em       = now(),
        -- O motivo mais novo vale: uma falha que muda de crédito para
        -- credencial é outra conversa com quem vai resolver.
        motivo          = excluded.motivo,
        detalhe         = excluded.detalhe,
        conversation_id = coalesce(excluded.conversation_id, chat.agent_failures.conversation_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function chat.registrar_falha_do_agente(uuid, text, text, uuid) is
  'Abre ou reforça a falha aberta da empresa. Repetição vira contador, não linha nova.';

create or replace function chat.resolver_falhas_do_agente(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_n integer;
begin
  update chat.agent_failures
     set resolvida_em = now()
   where company_id = p_company_id and resolvida_em is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function chat.resolver_falhas_do_agente(uuid) is
  'Fecha o aviso. Chamada quando o bot consegue enviar — que é o que "resolvido" quer dizer.';

revoke all on function chat.registrar_falha_do_agente(uuid, text, text, uuid) from public;
revoke all on function chat.resolver_falhas_do_agente(uuid)                   from public;
grant execute on function chat.registrar_falha_do_agente(uuid, text, text, uuid) to service_role;
grant execute on function chat.resolver_falhas_do_agente(uuid)                   to service_role;

commit;

notify pgrst, 'reload schema';
