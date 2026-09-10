-- A memória do contato, entre conversas.
--
-- Hoje o agente lembra de duas coisas: as últimas 40 mensagens **daquela**
-- conversa, e os campos da qualificação, que ficam no contato. Tudo o mais
-- que a pessoa contou morre com a conversa. Ela volta em março, repete a
-- história de janeiro, e o atendimento começa do zero — o que é exatamente a
-- sensação de falar com um robô.
--
-- Então o que ela disse de si vira linha. Não a resposta de um campo
-- cadastrado (isso já tem lugar), mas o resto: preferência, contexto, o que
-- aconteceu da última vez.
--
-- Três coisas que esta tabela carrega de propósito, e sem as quais ela seria
-- uma máquina de afirmar coisa velha com ar de intimidade:
--
--   1. **Quando** — todo fato guarda a data, e o prompt recebe "há 3 meses"
--      junto. Sem isso o modelo trata a intenção de compra do ano passado
--      como se fosse de agora.
--   2. **Quem** — bot ou atendente. O que uma pessoa escreveu à mão vale mais
--      e não é podado por robô nenhum.
--   3. **Apagável um a um** — não é o contato inteiro que se apaga quando
--      alguém pede para ser esquecido de uma coisa só. A linha é a unidade.
--
-- O que NÃO entra aqui: preço, prazo, condição de pagamento, disponibilidade.
-- Isso é da empresa e continua saindo só da base de conhecimento. Memória é
-- pista sobre a pessoa, nunca fato sobre a empresa — e o prompt diz isso.

begin;

-- -----------------------------------------------------------------------------
-- Quanto tempo faz
-- -----------------------------------------------------------------------------
-- Fica no banco, e não no TypeScript, porque quem monta o texto do prompt é o
-- banco — como em `render_knowledge` e `render_company_profile`. A exceção do
-- aviso de horário existe por precisar do fuso da empresa e de comparação de
-- dia de calendário; "há três meses" não precisa de nenhum dos dois.

create or replace function chat.faz_quanto_tempo(
  p_quando timestamptz,
  p_agora  timestamptz default now()
)
returns text
language sql
stable
as $$
  select case
    when d <   1 then 'hoje'
    when d <   2 then 'ontem'
    when d <  31 then 'há ' || d::int || ' dias'
    when d < 365 then 'há ' || m || case when m = 1 then ' mês'  else ' meses' end
    else              'há ' || a || case when a = 1 then ' ano'  else ' anos'  end
  end
  from (
    select dias,
           dias                             as d,
           greatest(1, (dias /  30)::int)   as m,
           greatest(1, (dias / 365)::int)   as a
      from (select extract(epoch from (p_agora - p_quando)) / 86400 as dias) t
  ) x;
$$;

comment on function chat.faz_quanto_tempo(timestamptz, timestamptz) is
  'Idade em português, para o prompt: hoje, ontem, há 5 dias, há 3 meses, há 2 anos.';

-- -----------------------------------------------------------------------------
-- A tabela
-- -----------------------------------------------------------------------------

-- Par único para a chave estrangeira composta logo abaixo. O contato já é
-- identificado só pelo `id`; isto existe para o banco poder exigir que a
-- memória e o contato sejam da mesma empresa.
create unique index if not exists contacts_id_empresa on chat.contacts (id, company_id);

create table if not exists chat.contact_memory (
  id              uuid primary key default gen_random_uuid(),
  /**
   * Preenchida sozinha a partir de quem está logado, para a tela poder gravar
   * sem carregar o id da empresa até o navegador. O servidor manda explícito,
   * porque roda com chave de serviço e não tem sessão.
   */
  company_id      uuid not null default chat.current_company()
                    references chat.companies(id) on delete cascade,
  contact_id      uuid not null references chat.contacts(id)  on delete cascade,
  /** O fato numa frase, do jeito que vai para o prompt. */
  fato            text not null,
  /**
   * A forma comparável do fato, como em `blocked_numbers.chave`: é sobre ela
   * que o índice único cai. Coluna gerada, e não índice por expressão, porque
   * `ON CONFLICT` precisa de coluna de verdade para o agente poder repetir a
   * mesma frase sem tomar erro. Espaço em excesso some junto com a caixa: o
   * modelo reescreve a mesma frase com dois espaços e acharia que é outra.
   */
  chave           text generated always as (lower(regexp_replace(btrim(fato), '\s+', ' ', 'g'))) stored,
  /** `bot` quando o agente apurou; `agente` quando uma pessoa escreveu. */
  origem          text not null default 'bot',
  /** Quem escreveu, quando foi gente. */
  agent_id        uuid references chat.agents(id) on delete set null,
  /**
   * Em que conversa a pessoa disse isso. É o caminho de volta para conferir a
   * frase original quando o fato parecer errado; a conversa some, o fato fica.
   */
  conversation_id uuid references chat.conversations(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint contact_memory_origem check (origem in ('bot', 'agente')),
  constraint contact_memory_fato   check (char_length(btrim(fato)) between 3 and 300),
  -- Memória e contato da mesma empresa, exigido pelo banco e não por quem
  -- chama. Sem isto, um id de contato de outra empresa passaria pela política
  -- de escrita — que só olha a empresa da linha, e a linha diria a verdade.
  constraint contact_memory_do_contato
    foreign key (contact_id, company_id)
    references chat.contacts (id, company_id) on delete cascade
);

comment on table chat.contact_memory is
  'O que se sabe da pessoa entre uma conversa e outra. Pista sobre ela, nunca fato sobre a empresa.';
comment on column chat.contact_memory.origem is
  'bot ou agente. O que uma pessoa escreveu não é podado pelo limite do robô.';

-- O modelo repete: conta a mesma coisa três turnos seguidos e chamaria a
-- ferramenta três vezes. Duplicata não é memória, é ruído no prompt.
create unique index if not exists contact_memory_sem_repetido
  on chat.contact_memory (contact_id, chave);

create index if not exists contact_memory_do_contato
  on chat.contact_memory (contact_id, created_at desc);

-- -----------------------------------------------------------------------------
-- O limite, e por que ele só pega o que o robô escreveu
-- -----------------------------------------------------------------------------
-- Memória sem teto é prompt sem teto: em dois anos de conversa o bloco passa
-- a base de conhecimento em tamanho, e cada mensagem paga por isso.
--
-- Quem sai é sempre o fato mais antigo do bot. O que um atendente digitou fica
-- — foi um ato deliberado de alguém que estava com a conversa aberta, e apagar
-- isso por causa de um contador seria decidir que o robô escreve melhor.

create or replace function chat.podar_memoria_do_contato()
returns trigger
language plpgsql
as $$
begin
  delete from chat.contact_memory m
   where m.contact_id = new.contact_id
     and m.origem = 'bot'
     and m.id not in (
       select id
         from chat.contact_memory
        where contact_id = new.contact_id and origem = 'bot'
        order by created_at desc, id desc
        limit 40
     );
  return null;
end;
$$;

drop trigger if exists trg_contact_memory_podar on chat.contact_memory;
create trigger trg_contact_memory_podar after insert on chat.contact_memory
  for each row when (new.origem = 'bot')
  execute function chat.podar_memoria_do_contato();

-- -----------------------------------------------------------------------------
-- O bloco que entra no prompt
-- -----------------------------------------------------------------------------
-- Vinte linhas, não quarenta: o teto de armazenamento existe para não perder
-- o que foi dito, o do prompt existe para o modelo conseguir ler. O que a
-- equipe escreveu vem primeiro, e depois o mais recente.

create or replace function chat.render_contact_memory(p_contact_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = chat, public
as $$
declare
  v_company uuid;
  v_texto   text;
begin
  select c.company_id into v_company from chat.contacts c where c.id = p_contact_id;
  if not found then
    return '';
  end if;

  -- SECURITY DEFINER: a função confere sozinha, senão bastaria passar o id de
  -- um contato de outra empresa para ler o que sabem dele.
  perform chat.assert_same_company(v_company);

  -- `id` desempata: dois fatos gravados no mesmo turno têm o mesmo instante, e
  -- ordem instável faria o prompt mudar sozinho entre uma mensagem e outra.
  select string_agg('- ' || m.fato || ' (' || chat.faz_quanto_tempo(m.created_at) || ')',
                    E'\n' order by m.ordem, m.created_at desc, m.id desc)
    into v_texto
    from (
      select id,
             fato,
             created_at,
             case when origem = 'agente' then 0 else 1 end as ordem
        from chat.contact_memory
       where contact_id = p_contact_id
       order by ordem, created_at desc, id desc
       limit 20
    ) m;

  return coalesce(v_texto, '');
end;
$$;

comment on function chat.render_contact_memory(uuid) is
  'A memória do contato em markdown, do jeito que entra no prompt do agente.';

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
-- Mesma regra do bloqueio de número: é ferramenta de quem atende, não de quem
-- administra. Quem está com a conversa aberta lê, escreve e apaga.

alter table chat.contact_memory enable row level security;

drop policy if exists contact_memory_equipe on chat.contact_memory;
create policy contact_memory_equipe on chat.contact_memory
  for all to authenticated
  using (chat.is_active_agent() and company_id = chat.current_company())
  with check (chat.is_active_agent() and company_id = chat.current_company());

grant select, insert, update, delete on chat.contact_memory to authenticated, service_role;

-- O `revoke` antes do `grant` não é zelo: função nasce com EXECUTE para
-- PUBLIC, e `anon` — o papel da chave anônima, que qualquer navegador carrega
-- — entra por aí. `assert_same_company` não barraria: ela deixa passar quando
-- não há usuário logado, porque é assim que o servidor a atravessa. Sem esta
-- linha, quem tivesse o uuid de um contato leria o que se sabe dele.
revoke all on function chat.faz_quanto_tempo(timestamptz, timestamptz) from public;
revoke all on function chat.render_contact_memory(uuid)                from public;
grant execute on function chat.faz_quanto_tempo(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function chat.render_contact_memory(uuid)                to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
