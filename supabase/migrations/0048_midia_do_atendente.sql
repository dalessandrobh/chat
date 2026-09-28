-- =============================================================================
-- 0048 — O atendente também manda arquivo
-- =============================================================================
-- Receber mídia o painel já sabia: a Evolution entrega o base64 junto do
-- evento, e a bolha desenha a foto. Mandar, não — quem atendia tinha de pegar
-- o celular, e a conversa ficava metade no painel e metade no aparelho.
--
-- O arquivo que sai não vem em base64 de lugar nenhum: é upload de quem está
-- atendendo. Ele vai para um bucket **privado**, e o que a Evolution recebe é
-- uma URL assinada de poucos minutos — tempo de ela baixar uma vez. Link de
-- conversa é conteúdo de cliente; público seria um endereço eterno que abre
-- sem senha para quem topar com ele.
--
-- `media.storagePath` guarda onde o arquivo ficou. É por ele que a bolha
-- reabre o que foi enviado, um mês depois, pela rota autenticada de sempre.

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('conversas', 'conversas', false, 16 * 1024 * 1024)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

-- `has_media` decidia pelo base64, que só existe no que chega. Sem isto, a
-- mídia enviada pelo painel viraria uma bolha com legenda e sem arquivo.
alter table chat.messages drop column if exists has_media;
alter table chat.messages
  add column has_media boolean
  generated always as (
    (media ->> 'base64') is not null or (media ->> 'storagePath') is not null
  ) stored;

comment on column chat.messages.has_media is
  'Tem arquivo para abrir: base64 no que chegou, caminho no bucket no que saiu.';

commit;

notify pgrst, 'reload schema';
