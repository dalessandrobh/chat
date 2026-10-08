-- =============================================================================
-- 0049 — Mensagem enviada pode ser editada e apagada
-- =============================================================================
-- Até aqui a mensagem era imutável: o que saía ficava como saiu, e quem errava
-- um número pegava o celular. Editar e apagar no WhatsApp são eventos que mexem
-- numa linha que já existe, não mensagens novas — por isso a linha ganha marcas,
-- em vez de ser trocada ou removida.
--
-- Apagar é soft delete. O realtime do painel só repassa UPDATE; um DELETE
-- deixaria a bolha na tela de quem está com a conversa aberta. O corpo fica no
-- banco (auditoria interna); quem esconde é a interface.
--
-- O texto antes da primeira edição vai para `original_body`, e o carimbo é
-- posto pelo banco: assim vale igual para o painel e para o webhook, quando a
-- edição nasce no celular.

begin;

alter table chat.messages
  add column if not exists edited_at     timestamptz,
  add column if not exists deleted_at    timestamptz,
  add column if not exists original_body text;

comment on column chat.messages.edited_at is
  'Quando o texto foi editado pela última vez. Nulo: nunca foi editada.';
comment on column chat.messages.deleted_at is
  'Quando foi apagada para todos. Nulo: continua visível. A linha não sai do banco.';
comment on column chat.messages.original_body is
  'Texto antes da primeira edição. Só para auditoria; a interface não mostra.';

-- Carimba a edição no próprio UPDATE do corpo.
create or replace function chat.stamp_message_edit()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body and new.deleted_at is null then
    new.original_body := coalesce(old.original_body, old.body);
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_message_stamps_edit on chat.messages;
create trigger trg_message_stamps_edit
  before update of body on chat.messages
  for each row execute function chat.stamp_message_edit();

-- O preview da lista só muda se a mensagem mexida for a última da conversa.
-- Editar uma antiga não pode reescrever a prévia da mais recente.
create or replace function chat.sync_conversation_on_message_change()
returns trigger
language plpgsql
as $$
declare
  v_preview text;
begin
  if exists (
    select 1 from chat.messages m
     where m.conversation_id = new.conversation_id
       and m.created_at > new.created_at
  ) then
    return new;
  end if;

  if new.deleted_at is not null then
    v_preview := '🚫 Mensagem apagada';
  else
    v_preview := left(
      coalesce(
        nullif(new.body, ''),
        case new.type
          when 'image'    then '📷 Imagem'
          when 'audio'    then '🎤 Áudio'
          when 'video'    then '🎬 Vídeo'
          when 'document' then '📎 Documento'
          when 'sticker'  then '🙂 Figurinha'
          when 'location' then '📍 Localização'
          when 'contacts' then '👤 Contato'
          when 'template' then '📋 Template'
          else new.type
        end
      ), 200);
  end if;

  update chat.conversations
     set last_message_preview = v_preview
   where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists trg_message_change_syncs_conversation on chat.messages;
create trigger trg_message_change_syncs_conversation
  after update of body, deleted_at on chat.messages
  for each row
  when (new.body is distinct from old.body
        or new.deleted_at is distinct from old.deleted_at)
  execute function chat.sync_conversation_on_message_change();

commit;

notify pgrst, 'reload schema';
