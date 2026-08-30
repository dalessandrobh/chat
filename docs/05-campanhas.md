# Campanhas agendadas

Disparo de mensagens para a base de clientes: texto, foto, vídeo, áudio ou
arquivo, com o ritmo controlado para o número não ser banido.

## O aviso que vem antes de tudo

Envio em massa por API não oficial é a forma mais confiável de queimar um
número de WhatsApp. Não existe "regra da Meta" a cumprir aqui — usar a
Evolution já contraria os termos de serviço; o que protege o número é
comportamento, não conformidade. Este módulo tenta parecer gente:

- intervalo **sorteado** entre envios (cadência exata é assinatura de robô);
- teto diário;
- janela de horário e dias da semana;
- `{nome}` no texto, para que duas mensagens não sejam byte a byte iguais;
- saída imediata de quem pede para parar.

Nenhuma dessas travas é garantia. Comece com teto baixo (50/dia) num número
que já conversa com clientes há um tempo, e suba devagar.

## As três tabelas

| Tabela | Papel |
|---|---|
| `chat.audience` | a base de envio: nome, número, tags |
| `chat.campaigns` | o que enviar, para quem, em que ritmo |
| `chat.campaign_recipients` | a fila, um por destinatário, com o status do envio |

`audience` nunca perde linhas. Quem pede para sair, ou cujo envio falhou, fica
com `is_sendable = false` e o motivo em `unsendable_reason`. É isso que impede
que a reimportação da planilha de amanhã ressuscite quem saiu hoje — o upsert
de `/api/audience` usa `ignoreDuplicates`, então um número já conhecido é
ignorado, não sobrescrito.

## Status do envio — e por que não há "inconclusivo"

`pending → sent → delivered → read`, ou `failed`, ou `skipped`.

O WhatsApp devolve recibo para toda mensagem: ou ela chega, ou dá erro. Não
existe estado permanente de dúvida, então o painel não inventa um. `sent` é
trânsito — a mensagem saiu e o recibo ainda não voltou; sempre vira
`delivered`/`read` ou `failed`. É por isso que a tela chama a coluna de
"a caminho" e não de "inconclusivo".

`skipped` é quem saiu da lista depois de entrar na fila: pediu para parar às
10h e o disparo era às 11h.

## O relógio

`src/instrumentation.ts` chama `tick()` a cada 15 s. Cada `tick()` envia **no
máximo uma** mensagem — acelerar aqui anularia o intervalo, que é a proteção
principal.

Quem decide *quem* e *quando* é o banco, em `chat.claim_next_send()`:

1. promove `scheduled → running` quando a hora chega;
2. pula campanha fora da janela de horário ou do dia da semana
   (`America/Sao_Paulo`);
3. pula campanha que já bateu o teto do dia;
4. sorteia o intervalo e compara com o último envio **do canal** — não da
   campanha: duas campanhas no mesmo número dobrariam a cadência, e é o número
   que é banido;
5. reserva um destinatário com `for update ... skip locked`.

As travas estão no banco de propósito. Elas precisam valer para qualquer coisa
que dispare, inclusive um script rodado na mão às três da manhã.

### Marca como enviado *antes* de chamar a API

`claim_next_send()` grava `status = 'sent'` antes de o envio acontecer. Se o
processo morrer no meio, o pior caso é uma mensagem que não saiu — não uma que
saiu duas vezes. Cliente recebendo a mesma promoção duas vezes é o que gera
denúncia, e denúncia é o que queima o número.

### Dias da semana

`campaigns.weekdays` é ISO: **1 = segunda … 7 = domingo**. O padrão `{1..6}`
deixa o domingo de fora. (Até a migração `0010` a função usava `dow`, em que
domingo é 0 — uma tela que gravasse 7 travaria a campanha sem erro nenhum.)

## Sair da lista

`src/lib/opt-out.ts` compara a mensagem recebida com uma lista de padrões
("pare", "não quero mais receber", "sair"…), e só em mensagens curtas — o
limite de 160 caracteres evita que um "não quero mais esperar, quero comprar"
tire um cliente da base.

Casando, o webhook chama `chat.opt_out()`, que marca `is_sendable = false` e
põe em `skipped` tudo que estava pendente para aquele número, e responde a
confirmação. Isso acontece **antes** de a mensagem ser encaminhada ao bot.

## Falha de envio

Falha marca o destinatário como `failed` e tira o número da lista
(`unsendable_reason = 'send_failed'`) — número que recusa entrega não melhora
com insistência, e insistir é justamente o padrão que denuncia um disparador.

A exceção é `reason === "disconnected"`: sessão caída é problema do canal, não
do número. Nesse caso o destinatário falha mas o contato continua enviável.

## Mídia

O arquivo sobe para o bucket `campanhas` do Storage e a Evolution busca pela
URL pública. A alternativa — mandar base64 a cada destinatário — subiria o
mesmo vídeo uma vez por pessoa. Teto de 16 MB, que é o que o WhatsApp aceita.

Áudio não tem legenda: vai sozinho, como mensagem de voz.

## O que ainda não existe

- **Nenhuma verificação de que o número tem WhatsApp** antes de enfileirar.
  A Evolution expõe `/chat/whatsappNumbers/{instance}`; passar a base por ali
  antes do disparo evitaria falhas em série, que é o pior sinal possível.
- **Retomada de campanha entre dias** funciona (o teto é por dia), mas nada
  avisa quando uma campanha fica dias parada.
- **Nada impede** criar dez campanhas para a mesma base no mesmo dia. O
  intervalo por canal segura a cadência, mas o teto diário é por campanha.
