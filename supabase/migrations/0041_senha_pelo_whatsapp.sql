-- A senha nova vai pelo WhatsApp de quem atende.
--
-- Trocar a senha de alguém sempre foi uma tela que mostra a senha na cara do
-- administrador e diz "anote agora, não aparece de novo". Funcionava enquanto
-- as duas pessoas estavam na mesma sala. Fora disso, a senha atravessava o
-- WhatsApp do administrador, ou um papel, ou a memória de alguém.
--
-- Agora ela vai direto para o número da pessoa. O WhatsApp já é o canal por
-- onde esta empresa trabalha o dia inteiro, e é o único que se pode garantir
-- que chega — o e-mail deste Auth nunca foi configurado para sair.
--
-- Guardar o número no agente é o que falta para isso: `auth.users` tem e-mail,
-- não telefone, e o telefone aqui não é credencial de login. É endereço de
-- entrega, e por isso mora ao lado do nome.

begin;

alter table chat.agents
  add column if not exists whatsapp text;

comment on column chat.agents.whatsapp is
  'Número para onde vai a senha nova. Endereço de entrega, não credencial de login.';

-- Mesmo formato do resto do schema: E.164 sem símbolos. Barrar aqui é melhor
-- do que descobrir no disparo que a senha foi para um número que não existe.
alter table chat.agents drop constraint if exists agents_whatsapp_formato;
alter table chat.agents add constraint agents_whatsapp_formato
  check (whatsapp is null or whatsapp ~ '^[1-9][0-9]{7,14}$');

commit;

notify pgrst, 'reload schema';
