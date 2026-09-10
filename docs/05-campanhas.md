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

## As tabelas

| Tabela | Papel |
|---|---|
| `chat.audience` | a base de envio: nome, número, etiquetas, grupo |
| `chat.contact_groups` | os grupos da empresa |
| `chat.campaigns` | o que enviar, para quem, em que ritmo |
| `chat.campaign_recipients` | a fila, um por destinatário, com o status do envio |

`audience` nunca perde linhas. Quem pede para sair, ou cujo envio falhou, fica
com `is_sendable = false` e o motivo em `unsendable_reason`. É isso que impede
que a reimportação da planilha de amanhã ressuscite quem saiu hoje — o upsert
de `/api/audience` usa `ignoreDuplicates`, então um número já conhecido é
ignorado, não sobrescrito.

## Grupo e etiqueta não são a mesma coisa

**Etiqueta é o que o contato tem; grupo é onde ele está.** Etiqueta se acumula
— alguém pode ser "sul", "obra nova" e "pediu catálogo" ao mesmo tempo. Grupo é
**um só, ou nenhum**: revendedor não é consumidor final, e as duas coisas pedem
campanhas diferentes com textos diferentes. Se o grupo aceitasse vários, seria
etiqueta com outro nome e a tela teria duas maneiras de fazer a mesma coisa.

Na campanha os dois se somam com **E**: grupo "Revendedores" mais etiqueta
"sul" atinge quem está nos dois. Nenhum dos dois escolhido é a base inteira,
como sempre foi. Quem quer a união monta duas campanhas — que é o que ela é de
verdade, com texto próprio para cada lado.

**"Sem grupo" é um recorte de verdade**, não a ausência de filtro: é quem
entrou pela última planilha e ninguém organizou ainda. Por isso ele é um botão
à parte (`p_sem_grupo`), e não um item na lista de ids.

A tela mostra a contagem enquanto a pessoa escolhe. Essa conta é feita duas
vezes de propósito — no navegador, para aparecer antes de existir campanha, e
no banco, que é quem manda. O número que vale é o que a tela informa depois de
criar.

Apagar um grupo **não apaga contato nenhum**: eles voltam a não ter grupo. É a
chave estrangeira que faz isso, e o `set null` nomeia a coluna — sem isso ele
zeraria `company_id` junto, que é `not null`, e apagar um grupo passaria a dar
erro.

## Enviar e não enviar

Todo contato nasce podendo receber. Sai da lista por quatro motivos, e o motivo
fica gravado em `unsendable_reason`:

| Motivo | Quem marca |
|---|---|
| `opt_out` | a própria pessoa, pedindo para sair |
| `no_whatsapp` | o provedor, quando o número não existe no WhatsApp |
| `send_failed` | uma falha de envio |
| `manual` | a equipe, pelo botão **Não enviar** |

Os quatro tiram o contato de qualquer recorte. A diferença aparece na volta:
devolver à lista quem pediu para sair exige uma confirmação com outro texto, e
o motivo antigo desce para as anotações antes de sumir — é o que sobra de
registro de que a pessoa pediu.

Nada é apagado por nenhum desses caminhos. A linha marcada é justamente o que
impede a planilha de amanhã de ressuscitar quem saiu hoje.

## Corrigir o texto com a campanha correndo

Campanha grande sai por horas, e a hora em que alguém percebe o erro de texto é
sempre depois do primeiro envio. Então o texto se corrige em **Ver mensagem →
Corrigir texto**, com a campanha em andamento.

Quem já recebeu recebeu — disso não há volta. A fila que falta passa a sair com
o texto novo, e isso não exigiu nada de novo no disparo: `claim_next_send` lê o
corpo da campanha a cada envio, então salvar já basta.

Só vale onde ainda existe fila: rascunho, agendada, correndo ou pausada.
Campanha encerrada ou cancelada recusa com `409` — não sobrou ninguém para
alcançar com a correção.

## Importar a base

A tela de Contatos lê **CSV e TSV** — não `.xlsx`. Um `.xlsx` é um zip de XML e
exigiria uma biblioteca; a única publicada no npm está parada desde 2022 com
falhas conhecidas, e não vale carregá-la para dentro do projeto quando o Excel
e o Google Planilhas exportam CSV em dois cliques.

`src/lib/planilha.ts` faz a leitura, separada da tela porque é a parte que
erra:

- **Codificação**: o Excel em português salva CSV em Windows-1252. Decodificar
  como UTF-8 transforma todo "José" em "Jos�" — e o nome é justamente o que vai
  dentro da mensagem. Se aparecer o caractere de substituição, relê em 1252.
- **Delimitador**: ponto e vírgula, tabulação ou vírgula, o que aparecer mais.
  Ponto e vírgula desempata, que é o padrão do Excel brasileiro.
- **Cabeçalho**: é cabeçalho se nenhuma célula da primeira linha vira um número
  válido. Colunas achadas pelo título (nome/cliente, telefone/celular/whatsapp,
  etiquetas/tags), em qualquer ordem; título desconhecido cai nas três
  primeiras colunas.
- **Repetidos**: primeira ocorrência vence. Planilha de CRM repete cliente com
  dois cadastros, e a primeira linha costuma ser a mais recente.

### O número

A normalização decide pelo **tamanho**, não pelo prefixo. O atalho óbvio —
"começa com 55, então já tem o país" — quebra em Santa Maria: o DDD 55 existe.
`55999998888` tem onze dígitos e é um celular do DDD 55, não um número já
internacionalizado.

| Dígitos | Leitura |
|---|---|
| 11 | DDD + celular → acrescenta 55 |
| 10 | DDD + 8 dígitos → acrescenta 55, com ressalva do 9º dígito |
| 13 começando com 55 | já completo |
| 12 começando com 55 | completo, com ressalva do 9º dígito |
| 12 a 15 | outro país, passa como está |
| até 9 | recusado: falta o DDD |

Nada é gravado antes de a tela mostrar o que entendeu. O caminho ruim aqui não
é a linha recusada — é importar mil contatos com a coluna errada e ter que
desfazer no banco.

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
2. pula campanha cujo canal está **pausado** na tela de Canais — pausar um
   número cala tudo que sai dele sozinho, campanha inclusive;
3. pula campanha fora da janela de horário ou do dia da semana
   (`America/Sao_Paulo`);
4. pula campanha que já bateu o teto do dia;
5. sorteia o intervalo e compara com o último envio **do canal** — não da
   campanha: duas campanhas no mesmo número dobrariam a cadência, e é o número
   que é banido;
6. reserva um destinatário com `for update ... skip locked`.

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

## Sair da lista pedindo

O caminho automático do `opt_out` da tabela acima. `src/lib/opt-out.ts` compara a mensagem recebida com uma lista de padrões
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
- **A campanha não guarda o recorte que a montou.** Grupo e etiqueta escolhidos
  viram destinatários e somem; a lista de quem recebeu é o único registro. Quem
  quiser repetir a campanha da semana passada refaz a escolha na mão.
- **Trocar o grupo de muitos contatos de uma vez** só pela importação, que
  aplica o grupo ao lote inteiro. Contato a contato, é na linha da tela.
