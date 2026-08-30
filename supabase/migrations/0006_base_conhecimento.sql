-- =============================================================================
-- 0006 — Base de conhecimento
-- =============================================================================
-- O que o agente sabe sobre o negócio: produtos, região, garantia, respostas
-- prontas. Vai inteira no prompt, a cada mensagem.
--
-- Sem embeddings e sem busca vetorial de propósito. Uma base de uma empresa
-- — catálogo, cobertura, garantia, perguntas frequentes — cabe em poucos
-- milhares de tokens, e mandá-la inteira elimina o modo de falha mais chato
-- de RAG: a busca não trazer o trecho certo, em silêncio, e o agente
-- responder com confiança pelo que sobrou. Quando a base não couber mais no
-- contexto, esta tabela vira a fonte do índice vetorial sem precisar mudar
-- de lugar.
--
-- Em seções, não num campo só: dá para editar um pedaço sem reler tudo,
-- desligar um trecho sem apagar, e o agente recebe com títulos.

create table if not exists chat.knowledge (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  -- Ordem em que as seções entram no prompt. O que vem antes pesa mais.
  position    integer not null default 0,
  -- Desligar em vez de apagar: útil para promoção que acabou e volta.
  is_active   boolean not null default true,
  updated_by  uuid references chat.agents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint knowledge_title_len   check (char_length(title) between 1 and 120),
  constraint knowledge_content_len check (char_length(content) between 1 and 20000)
);

comment on table chat.knowledge is
  'Seções da base de conhecimento, concatenadas no prompt do agente a cada mensagem.';
comment on column chat.knowledge.position is
  'Ordem no prompt. Menor primeiro.';

create index if not exists idx_knowledge_ordem
  on chat.knowledge (position, created_at) where is_active;

drop trigger if exists trg_knowledge_touch on chat.knowledge;
create trigger trg_knowledge_touch before update on chat.knowledge
  for each row execute function chat.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RENDERIZAÇÃO
-- -----------------------------------------------------------------------------
-- Montar o texto no banco, e não no painel nem no n8n, garante que o agente
-- e a tela de conferência vejam exatamente a mesma coisa.

create or replace function chat.render_knowledge()
returns text
language sql
stable
as $$
  select coalesce(
    string_agg('## ' || title || E'\n' || content, E'\n\n' order by position, created_at),
    ''
  )
  from chat.knowledge
  where is_active;
$$;

comment on function chat.render_knowledge is
  'Base ativa como texto único, pronta para o prompt.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table chat.knowledge enable row level security;

grant select on chat.knowledge to authenticated;
grant all    on chat.knowledge to service_role;
grant execute on function chat.render_knowledge() to authenticated, service_role;

drop policy if exists knowledge_select on chat.knowledge;
create policy knowledge_select on chat.knowledge
  for select to authenticated using (chat.is_active_agent());

-- Mesma régua dos templates: é conteúdo de atendimento, então gestor cuida.
drop policy if exists knowledge_write on chat.knowledge;
create policy knowledge_write on chat.knowledge
  for all to authenticated
  using (chat.is_manager()) with check (chat.is_manager());
