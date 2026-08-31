-- =============================================================================
-- 0012 — Ajustes do painel
-- =============================================================================
-- Chave e valor, porque o que se ajusta aqui é decisão de operação e não de
-- código: ler ou não a imagem que o cliente manda custa dinheiro por mensagem,
-- e quem decide isso é quem paga a conta, sem precisar de deploy.
--
-- Primeira chave: `ler_imagens`. Desligada, o bot explica que não abre esses
-- arquivos e pergunta se a pessoa quer falar com alguém — pergunta, não
-- transfere: mandar para a fila humana toda foto que chega é o custo que a
-- chave existe para evitar.

create table if not exists chat.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references chat.agents(id) on delete set null
);

drop trigger if exists trg_settings_touch on chat.settings;
create trigger trg_settings_touch
  before update on chat.settings
  for each row execute function chat.touch_updated_at();

-- Ligada por padrão: é como o painel já se comportava quando a chave da
-- Anthropic existe.
insert into chat.settings (key, value)
values ('ler_imagens', 'true'::jsonb)
on conflict (key) do nothing;

alter table chat.settings enable row level security;

grant select on chat.settings to authenticated;
grant all    on chat.settings to service_role;

-- Todo mundo lê — a tela de conversas pode querer mostrar o estado. Só gestor
-- e administrador mudam.
drop policy if exists settings_select on chat.settings;
create policy settings_select on chat.settings
  for select to authenticated using (chat.is_active_agent());

drop policy if exists settings_write on chat.settings;
create policy settings_write on chat.settings
  for all to authenticated using (chat.is_manager()) with check (chat.is_manager());
