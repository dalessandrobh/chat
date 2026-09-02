-- Mídia visível no painel do dono.
--
-- Os bytes sempre estiveram no banco: a Evolution manda o arquivo em base64
-- junto do evento e o webhook guarda em `messages.media`. O painel nunca
-- serviu isso — mostrava "📷 image/jpeg" e a descrição automática, e quem
-- atendia respondia sobre uma foto que não podia ver.
--
-- Servir os bytes é uma rota. O problema estava em ler a lista de mensagens:
-- o painel fazia `select *`, então baixava todo o base64 para o navegador
-- para desenhar um ícone. Um vídeo de 1,8 MB viajava inteiro a cada vez que
-- a conversa era aberta, e era descartado.
--
-- Estas colunas existem para que a lista traga o que descreve a mídia sem
-- trazer a mídia. São geradas: ninguém precisa lembrar de preenchê-las, e
-- não podem divergir do que está em `media`.

alter table chat.messages
  add column if not exists media_mime text
    generated always as (media->>'mimeType') stored,
  add column if not exists media_filename text
    generated always as (media->>'filename') stored,
  add column if not exists media_seconds int
    generated always as (nullif(media->>'seconds','')::int) stored,
  -- O que decide se a rota tem o que servir. Mídia sem bytes acontece:
  -- evento que chegou sem o arquivo, ou mensagem antiga apagada na origem.
  add column if not exists has_media boolean
    generated always as (media->>'base64' is not null) stored;

comment on column chat.messages.has_media is
  'Tem bytes para servir em /api/messages/:id/media. Gerada de media->base64.';

-- O mesmo arquivo estava guardado duas vezes: `media.base64` e
-- `payload.base64`, que é o evento cru da Evolution. O payload existe para
-- depurar o que o provedor mandou — e para isso a chave `base64` não
-- acrescenta nada que `media` já não tenha.
--
-- Em 26 mensagens de mídia isso era metade de uma tabela de 17 MB. Numa
-- plataforma com muitas empresas seria metade do backup.
update chat.messages
   set payload = payload - 'base64'
 where payload ? 'base64';
