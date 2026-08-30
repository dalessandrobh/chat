-- =============================================================================
-- 0007 — Substituição atômica da base
-- =============================================================================
-- Importar troca a base inteira. Feito em duas chamadas — apagar, depois
-- inserir — existe uma janela em que o agente responde sem base nenhuma, e é
-- justamente a janela em que ele mais inventaria. Aqui as duas operações são
-- uma transação só.

create or replace function chat.replace_knowledge(p_sections jsonb)
returns integer
language plpgsql
security definer
set search_path = chat, public
as $$
declare
  v_total integer;
begin
  if not chat.is_manager() then
    raise exception 'Apenas gestores e administradores podem importar a base'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'Nada para importar';
  end if;

  -- `where true` não é enfeite: o Supabase carrega o pg_safeupdate, que
  -- recusa DELETE sem WHERE. Aqui apagar tudo é a intenção, e dizer isso
  -- explicitamente é melhor do que desligar a proteção.
  delete from chat.knowledge where true;

  insert into chat.knowledge (title, content, position, is_active, updated_by)
  select
    s ->> 'title',
    s ->> 'content',
    coalesce((s ->> 'position')::integer, 0),
    coalesce((s ->> 'is_active')::boolean, false),
    nullif(s ->> 'updated_by', '')::uuid
  from jsonb_array_elements(p_sections) as s;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

comment on function chat.replace_knowledge is
  'Troca a base inteira numa transação. Exige gestor: roda como security '
  'definer, então a checagem de permissão é explícita.';

revoke all on function chat.replace_knowledge(jsonb) from public, anon;
grant execute on function chat.replace_knowledge(jsonb) to authenticated, service_role;
