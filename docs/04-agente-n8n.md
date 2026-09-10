# Fase 1 — O agente de atendimento no n8n

O que muda: sai o fluxo de palavra-chave, entra um agente com modelo, prompt,
ferramenta e memória.

## Como ele pensa

```
Painel  ──webhook──▶  n8n
                       │
                       ├─ é texto?  não ─▶ avisa e chama humano
                       │
                       ├─ busca o histórico no painel
                       ├─ conversa ainda está com o bot? não ─▶ encerra
                       │
                       └─ Agente (Claude)
                            ├── ferramenta: escalar_para_humano
                            └── já escalou?
                                 ├─ sim ─▶ encerra
                                 └─ não ─▶ tem resposta?
                                            ├─ sim ─▶ POST /api/internal/send
                                            └─ não ─▶ chama humano
```

## A memória é `chat.messages`, não a do n8n

O n8n tem nó de memória que guarda o histórico numa tabela própria. Não usamos.

Ela só enxergaria o que passou pelo workflow — ficariam de fora as mensagens
que você digita no seu próprio celular, que é justamente o que se ganha ao
usar a Evolution. O agente responderia como se aquela conversa não tivesse
existido, repetindo o que você já respondeu na mão.

Por isso o workflow busca `/api/internal/conversations/:id/context`, que
devolve a conversa inteira do banco — painel, celular e bot na mesma linha do
tempo. As 40 últimas mensagens, o bastante para o assunto atual sem inflar o
prompt.

Isso é a memória **da conversa**. A memória **da pessoa**, que atravessa
conversas, é outra coisa e está em [A memória do contato](#a-memória-do-contato).

## Versão do n8n

Rodando **2.37.4**. A mínima é 1.123: as anteriores mandavam `top_p: -1` em
toda chamada, e nenhum modelo Claude atual aceita parâmetro de amostragem
(`400 top_p is deprecated for this model`), sem jeito de desligar pelo
workflow.

Pelo mesmo motivo o nó `Claude` não tem `temperature` nem `topP`. Não
adicione: qualquer um dos dois derruba a chamada.

## Antes de importar

Você precisa de uma **chave da API da Anthropic** (console.anthropic.com →
API Keys). É a única coisa que falta e que não posso providenciar. Cobrança é
por uso, e uma conversa de atendimento custa centavos.

## Importar

1. https://n8n.dsearch.com.br → **Workflows** → **Import from File**
2. Escolha `n8n-workflows/02-agente-atendimento.json`

Duas credenciais, criadas uma vez:

**Header Auth** — nome exato `Chat — token de serviço`
- Name: `Authorization`
- Value: `Bearer <CHAT_SERVICE_TOKEN>` (está em `infra/chat-app/.env`)

Ela serve para os dois lados: valida a chamada que o painel faz no webhook e
autentica as chamadas que o n8n faz de volta.

**Anthropic** — cole a chave da API no nó `Claude`.

Depois **Active** no canto superior direito. Workflow inativo não atende.

### Importar apaga as credenciais

Tanto o "Import from URL" quanto o `n8n import:workflow` descartam o vínculo
das credenciais: os nós voltam sem nenhuma. Depois de qualquer reimportação,
percorra os nove nós que precisam de credencial — `Mensagem recebida`,
`Buscar contexto`, `Responder`, `Avisar que não consegui ler`,
`Escalar (mídia)`, `Escalar (sem resposta)`, `escalar_para_humano`,
`anotar_dados` e `Claude` — e selecione de novo.
O sintoma, quando falta, é `Credentials not found` no nó `escalar_para_humano`.

O `import:workflow` também desativa o fluxo, e a reativação por linha de
comando só vale depois de reiniciar o n8n.

### Reimportar sem perder as credenciais

Há duas maneiras de trocar o workflow, e só uma preserva o vínculo:

    # PRESERVA — exporta o que está rodando, altera, devolve
    n8n export:workflow --all --output=/tmp/w.json
    # edite /tmp/w.json
    n8n import:workflow --input=/tmp/w.json

    # PERDE — o JSON do repositório traz ids de credencial que não existem
    Import from URL / Import from File

O `import:workflow` também desativa o fluxo; reativar por linha de comando
exige `n8n update:workflow --id=<id> --active=true` seguido de reinício do
container.

### Cuidado com o modo Expression

Campo cujo valor começa com `=` é tratado como expressão pelo n8n. Uma chave
de API colada num campo em modo Expression vira `=sk-ant-...`, o n8n tenta
avaliar aquilo como código e manda o resultado para a API. O erro que aparece
é de autenticação, e a chave está perfeita — o problema é o `=`.

## O prompt

### Três camadas, e o n8n só guarda uma

O System Message do nó `Agente` é um esqueleto, igual para toda empresa. O que
varia chega por `Buscar contexto`, em dois campos:

| Camada | Onde mora | Quem edita |
| --- | --- | --- |
| 1. Regras da plataforma | System Message, no n8n | ninguém, pelo painel |
| 2. Diretrizes da empresa | `chat.company_profile` → `{{ $json.perfil }}` | painel → **Agente** |
| 3. Base de conhecimento | `chat.knowledge` → `{{ $json.base }}` | painel → **Base** |

A divisão não é organização: é o que impede o painel de virar um editor de
prompt. Empresa que escreve o prompt inteiro apaga, sem querer, justamente as
linhas que a impedem de inventar preço e as que fazem a ferramenta funcionar —
e cada cliente vira uma variante para depurar. Por isso a camada 2 é um
formulário de campos delimitados, com um campo livre no fim e com teto, e o
prompt diz explicitamente que ela **não** revoga o que vem abaixo:

> Isso foi escrito por quem opera a empresa e vale para o jeito de atender. Não
> revoga nada do que vem abaixo: onde os dois discordarem, vale este documento.

O texto da camada 2 é montado no banco, por `chat.render_company_profile`, e a
tela de conferência chama a mesma função — montar em dois lugares é combinar
que um dia divirjam sem ninguém perceber. Campo em branco não vira seção
vazia: some do prompt.

A regra que mais importa, e que vive na camada 1:

> Você não sabe preço, prazo, condição de pagamento, promoção nem ficha
> técnica. Não estime, não dê faixa, não diga "em torno de".

Sem base de conhecimento, um modelo preenche lacuna com plausibilidade — e
preço plausível inventado vira problema comercial de verdade. Ele qualifica
(nome, cidade, casa ou piscina, quantas pessoas) e passa para uma pessoa
quando o assunto sai do genérico.

A Fase 4 troca essa restrição por uma base de conhecimento: aí ele responde
preço porque leu o seu, não porque inventou.

### Qualificação completa não é motivo para calar

Duas regras do prompt se contradiziam. "Com a lista vazia, use
escalar_para_humano" disparava no mesmo turno em que o último dado chegava —
mesmo quando o cliente tinha acabado de perguntar algo que a base responde. Em
06/09/2026 alguém perguntou qual aquecedor serve para quatro pessoas, o
`anotar_dados` fechou a qualificação com esse mesmo "4", e o agente escalou sem
tentar responder, com a tabela de dimensionamento na frente dele.

Agora as duas regras — a do prompt e a `toolDescription` do
`escalar_para_humano`, que o modelo lê junto — dizem que pergunta pendente vem
primeiro: responde, escala na mensagem seguinte. E ler tabela da base está
explicitamente permitido, porque é leitura do que está escrito, não
estimativa. Que a tabela em questão seja de dimensionamento de aquecedor é
diretriz da Eco Aquecedores, e mora no perfil dela — não no prompt de todo
mundo.

## A despedida sai pela ferramenta, não pelo agente

`escalar_para_humano` manda a mensagem de despedida **antes** de trocar o modo
para `human`, e é por isso que ela mora no endpoint e não no fluxo.

Se o agente escalasse primeiro e falasse depois, a fala esbarraria na própria
trava de handoff: o modo já seria `human`, `/api/internal/send` devolveria 409
e o cliente ficaria sem resposta nenhuma — escalado em silêncio.

### E quem escreve a despedida é o modelo

O texto era fixo no nó da ferramenta, e isso custou uma resposta certa. Em
06/09/2026 o modelo respondeu bem a pergunta de dimensionamento —

> Com 4 pessoas, considerando 2 banhos por dia cada (total de 8 banhos/dia), o
> ideal é o ECO-230! 🙌 Vou chamar um consultor pra fechar os detalhes com você.

— mas escreveu isso **no mesmo turno** em que chamou `escalar_para_humano`. O
laço de agente do n8n descarta o texto que vem junto de uma tool call: só o
`output` da última rodada chega ao nó `Responder`. O cliente recebeu a
despedida genérica, e a resposta boa foi para o lixo.

Agora `message` é um parâmetro do modelo (`modelRequired`, corpo em keypair) e
a instrução é explícita: se há pergunta que a base responde, a resposta vai ali
junto com o aviso, numa mensagem só. `conversationId` e `reason` continuam
fixos no nó — quem chama não escolhe em nome de quem age.

### `Já escalou?`

Depois de usar a ferramenta o modelo às vezes ainda escreve uma frase de
fecho. Ela virava `output`, o `Responder` tentava mandar, e o `/send` devolvia
409 porque a conversa já era humana — execução vermelha por nada. O IF
`Já escalou?`, entre o `Agente` e o `Tem resposta?`, encerra a rodada que
chamou `escalar_para_humano`.

## Resposta vazia não vai para o `send`

Entre o `Agente` e o `Responder` existe um IF, `Tem resposta?`. Só passa quem
tem texto; o resto vai para `Escalar (sem resposta)`.

O motivo é um silêncio real, em 06/09/2026: com a qualificação já fechada e
duas escalações na transcrição, o modelo devolveu `output: ""` — zero tokens
de saída, nenhuma ferramenta chamada. O `Responder` mandou `text: ""`,
`/api/internal/send` recusou com

    {"error":"Payload inválido","issues":[{"code":"too_small","path":["text"]}]}

e, como o nó tinha `neverError`, a execução foi marcada **success**. O cliente
perguntou duas vezes e não recebeu nada, e nada apareceu como erro.

Agora resposta vazia vira escalação, com `reason: 'O agente devolveu resposta
vazia'` — visível em `chat.handoff_events`, que é onde se conta quantas vezes
isso acontece.

O `neverError` saiu do `Responder`. Ele existia para uma recusa do `/send` não
derrubar o fluxo, e o preço era esse: recusa nenhuma aparecia. Qualquer outro
4xx — janela de 24h vencida, conversa que virou humana no meio da rodada —
agora deixa a execução vermelha na lista do n8n, que é onde se procura.

Os outros nós de HTTP continuam com `neverError`, de propósito: `Avisar que
não consegui ler`, `Escalar (mídia)` e `Escalar (sem resposta)` são o último
recurso de uma rodada que já deu errado, e falhar ali só trocaria um silêncio
por outro.

## Foto e áudio viram texto antes de chegar aqui

O agente lê `chat.messages`, e mensagem sem corpo não diz nada a ele. Foto do
telhado e áudio de trinta segundos chegavam como `(image)` / `(audio)` e a
conversa ia direto para uma pessoa.

Agora o painel lê a mídia **antes** de acionar o bot:

| Tipo | Como | Chave |
|---|---|---|
| Imagem, figurinha | Claude, pela Messages API | `ANTHROPIC_API_KEY` |
| Áudio | Whisper | `AUDIO_API_KEY` |
| Vídeo, documento | ninguém — segue para uma pessoa | — |

O texto entendido é gravado no `body` da própria mensagem. Daí em diante nada
mais sabe que aquilo veio de uma foto: a transcrição entra no histórico, o
painel mostra o conteúdo, e o nó `Tem texto?` deixa passar.

**Sem chave, nada quebra.** A mídia continua indo para uma pessoa, com o aviso
de sempre. É por isso que o nó chama `Tem texto?` e não `É texto?`: o que
importa é haver o que responder, não como chegou.

**Ler imagem é uma chave no painel** (Ajustes), em `chat.settings.ler_imagens`.

O que decide a resposta não é o tipo do arquivo, é se sabíamos de antemão que
não íamos ler:

| Situação | O que acontece |
|---|---|
| Imagem, leitura ligada | descreve e responde |
| Imagem, leitura desligada | explica e **pergunta** |
| **Vídeo, sempre** | explica e **pergunta** |
| Áudio com chave | transcreve e responde |
| Tentou ler e falhou | vai para a fila humana |

Perguntar deixa a conversa **com o bot**. Quem responde "sim" é atendido pelo
caminho normal: o agente lê o "sim" logo abaixo da própria pergunta e usa
`escalar_para_humano`. Transferir na hora seria decidir pela pessoa, e gastar
um atendente em cada arquivo é o custo que a chave existe para evitar.

Falha é diferente de propósito: aí ninguém escolheu nada, e a fila humana é a
saída certa.

A frase muda com o estado da chave — dizer "não leio imagens" para quem teve
uma foto respondida duas mensagens acima seria mentira.

**No painel o texto vem rotulado** — "🎤 áudio — transcrito automaticamente".
Sem o rótulo o atendente lê a descrição da foto como se o cliente tivesse
escrito aquilo, e responde a uma frase que ninguém disse.

A leitura acontece fora da requisição do webhook. Descrever imagem leva alguns
segundos e a Evolution reenvia o evento se demorarmos a responder — uma foto
viraria duas mensagens.

## Uma resposta por rajada, não por mensagem

No WhatsApp ninguém escreve um parágrafo. Escreve "oi", "queria saber",
"sobre aquecedor solar" — três webhooks em cinco segundos. Antes disso o
agente rodava três vezes, cada resposta em cima de meia pergunta, e as
respostas ainda chegavam fora de ordem.

Agora a mensagem de texto não vai direto para o n8n. Ela entra numa janela
deslizante em `chat.message_batches`:

- cada mensagem nova empurra o vencimento para **8 segundos** à frente;
- o cliente para de digitar, a janela vence, o agente roda **uma vez**;
- quem nunca para esbarra no teto de **40 segundos** e é respondido assim
  mesmo — esperar para sempre é o mesmo que não responder.

O `text` do payload vai se emendando: o agente recebe as três linhas juntas,
não só a última. Quem conta os segundos é o relógio de `instrumentation.ts`,
que bate a cada 2s e quase sempre não acha nada.

**Mídia não espera.** Áudio e imagem seguem direto, porque o aviso de "não
leio áudio" e a escalação que vem junto não podem ficar oito segundos parados
atrás de uma janela.

Para mexer na janela, os parâmetros são da função
`chat.enqueue_bot_turn(..., p_janela, p_teto)` — não há nada disso no n8n, que
continua recebendo um POST por turno como sempre recebeu.

## A fila de perguntas não mora no prompt

O agente qualifica, mas nem a lista do que perguntar nem a do que ainda falta
estão escritas no System Message. As duas chegam prontas em
`{{ $json.faltando }}`, vindas de `Buscar contexto`.

Por que assim: com a lista fixa no prompt, o agente relia a conversa a cada
mensagem para adivinhar o que já tinha perguntado. Quando o cliente ignorava,
o dado continuava faltando e a pergunta voltava idêntica — cinco vezes
seguidas num teste de dez mensagens.

Agora o dado respondido sai da fila de verdade:

1. o cliente responde qualquer um dos itens;
2. o agente chama `anotar_dados`, que grava em
   `chat.contacts.metadata.qualificacao`;
3. no turno seguinte, `Buscar contexto` monta `faltando` sem aquele item.

Quem ignora a pergunta também sai da fila, por dois caminhos: o agente manda o
nome do campo em `dispensados`, ou o próprio contexto desiste. Cada vez que
`Buscar contexto` entrega uma pergunta, ela conta como tentativa; passou de
`LIMITE_TENTATIVAS` (duas) sem resposta, o campo é descartado sozinho.

O contador existe porque "não repita" só funciona quando alguém conta, e o
modelo não conta: ele relê a conversa, vê o dado faltando e pergunta de novo.

Tudo isso vale para conversas futuras — a pessoa some por um mês, volta, e a
cidade dela continua gravada.

### Quais perguntas são cadastro, não código

Até 06/09/2026 os quatro campos — nome, cidade, uso, pessoas — eram uma lista
em `app/src/lib/qualificacao.ts`. Escritos para uma revendedora de aquecedor
solar: numa clínica, o mesmo bot perguntaria ao paciente quantas pessoas usam
o chuveiro, com convicção.

Agora eles são linhas de `chat.qualification_fields`, por empresa, editáveis em
**Agente**. O que o código ainda decide é a mecânica: a ordem, o contador de
tentativas, o que fazer com um dado recusado.

Cada linha tem:

- **chave** — o nome do dado dentro de `metadata.qualificacao`. É ela que o
  agente manda de volta em `anotar_dados`, e por isso ela vai no prompt junto
  da pergunta (`cidade — em que cidade o aquecedor vai ser instalado`). Não é
  editável depois de criada: renomear faria toda resposta já gravada virar
  órfã, e a pergunta voltaria para a fila de quem já tinha respondido.
- **tipo** — `texto` ou `numero`. Em campo numérico, "umas quatro" é recusado:
  texto onde se espera conta é dado sujo, e quem lê depois não tem como saber
  que era palpite.
- **dependência** — a pergunta só entra na fila quando outra já foi respondida
  com um valor que casa com uma expressão. É o que era o `ehCasa` cravado:
  `pessoas` depende de `uso` casar com `cas[ae]|residenc`. A comparação
  acontece sem acento e sem caixa, porque o cliente escreve "residência",
  "residencia" e "Minha Casa".

Como a ferramenta do n8n é uma só para todas as empresas, ela não pode ter um
parâmetro por campo. `anotar_dados` manda um objeto: `{"cidade": "Belo
Horizonte", "pessoas": 4}`. Chave que não estiver cadastrada é descartada na
rota e volta em `ignorado` — modelo inventa chave, e dado inventado no
metadata do contato ninguém descobre depois.

## A memória do contato

A fila de qualificação guarda o que a empresa perguntou. O que a pessoa conta
de si fora disso — como prefere ser chamada, com o que trabalha, por que está
procurando agora — morria com a conversa. Ela voltava em março, repetia a
história de janeiro, e o atendimento recomeçava do zero: que é exatamente a
sensação de falar com um robô.

Agora vira linha em `chat.contact_memory`, uma frase por vez, presa ao contato
e não à conversa. O agente manda em `lembrar`, na mesma chamada de
`anotar_dados` que ele já fazia — uma ferramenta a mais seria uma chance a mais
de o modelo chamar a errada.

### O que impede isso de virar uma máquina de afirmar coisa velha

Memória é o caminho mais curto para o bot dizer com intimidade algo que deixou
de ser verdade. Três coisas seguram isso, e nenhuma delas está no prompt:

- **Quando.** Todo fato guarda a data, e o prompt recebe "há 3 meses" colado
  na frase. Sem isso o modelo trata a intenção de compra do ano passado como se
  fosse de hoje. O prompt manda confirmar antes de agir sobre coisa antiga.
- **Quem.** `origem` separa o que o bot apurou do que um atendente escreveu. O
  que uma pessoa digitou não é podado por robô nenhum.
- **Apagável um a um.** A unidade é a linha, não o contato: quem pede para ser
  esquecido de uma coisa não está pedindo para sumir inteiro.

E a regra que o prompt repete: memória é **pista sobre a pessoa, nunca fato
sobre a empresa**. Preço, prazo, condição e disponibilidade continuam saindo só
da base — o bloco da memória diz isso ao modelo em voz alta.

### Dois tetos, por dois motivos diferentes

| Teto | Onde | Por quê |
|---|---|---|
| 40 fatos do bot por contato | gatilho na tabela | memória sem teto é prompt sem teto; sai sempre o mais antigo **do bot** |
| 20 linhas no prompt | `chat.render_contact_memory` | o que a equipe escreveu vem primeiro, depois o mais recente |

O teto de armazenamento existe para não perder o que foi dito; o do prompt,
para o modelo conseguir ler. São perguntas diferentes e por isso são números
diferentes.

Repetido não entra: `chave` é coluna gerada — a frase sem caixa e sem espaço
sobrando — e um índice único cai sobre ela. O modelo conta a mesma coisa três
turnos seguidos, e a linha continua sendo uma.

### A tela

No inbox, recolhida entre a barra de handoff e a conversa: **Sobre a Mary ·
3 anotações**. Aberta, cada linha tem um × e há um campo para anotar à mão.

Não é enfeite. Sem ela a memória seria um depósito cego: o modelo entende
errado, e a frase errada entraria em todo prompt futuro sem ninguém ver. É
também por ali que se apaga um item a pedido de quem escreveu.

### Onde não fica

No Postgres do n8n, não. Memória do contato é dado de cliente: precisa da mesma
RLS de `contacts` — a memória de uma empresa não pode chegar ao agente de outra
—, precisa aparecer no painel, e precisa sobreviver a um workflow reimportado.
O banco do n8n foi separado de propósito para as automações não dependerem do
ciclo de vida do Supabase; dado de cliente ali dentro desfaria a separação.

O banco exige o parentesco, em vez de confiar em quem chama: `company_id` nasce
de `chat.current_company()` e a chave estrangeira é composta,
`(contact_id, company_id) → contacts (id, company_id)`. Passar o id de um
contato de outra empresa não passa pela política de escrita — ela olharia a
empresa da linha, e a linha estaria dizendo a verdade.

## Testar

Mande mensagem de outro celular. Se a conversa estiver em atendimento humano
— e ela fica, sempre que você responde pelo aparelho — o agente não fala.
Clique em **Devolver ao bot** no painel primeiro.

Se algo falhar, o rastro está em **Executions** no n8n, nó a nó, com o que
entrou e o que saiu.

---

# Base de conhecimento

Painel → **Base**. Seções de texto que vão inteiras no prompt a cada mensagem.

## Ligada x desligada

Seção desligada não é lida. É o botão que separa rascunho de verdade: escreva
à vontade, e ligue só quando tiver conferido — o agente trata o que estiver
ligado como fato, sem hesitação.

Seção nova nasce desligada de propósito.

## A regra de preço se ajusta sozinha

O prompt diz: **informe preço, prazo, pagamento e disponibilidade apenas se
estiver escrito na base, exatamente como está; não estando, escale.**

Então não há dois passos a coordenar. Enquanto a seção *Preços* estiver
desligada, o agente continua escalando toda pergunta de valor. No dia em que
você preencher e ligar, ele passa a responder — com o seu número, não com um
inventado. Nada a mudar no prompt.

O que não muda nunca: ele não estima, não arredonda e não diz "em torno de".

## Sem embeddings, de propósito

A base vai inteira, sem busca vetorial. Uma empresa cabe em poucos milhares de
tokens, e mandar tudo elimina o pior modo de falha de RAG: a busca não trazer
o trecho certo, em silêncio, e o agente responder com confiança pelo que
sobrou.

Também evita um fornecedor a mais — a Anthropic não tem API de embeddings.

A tela mostra quantos caracteres chegam ao agente. Acima de ~12.000 ela avisa:
aí sim vale conversar sobre busca vetorial, e `chat.knowledge` já é a tabela
certa para virar índice.

## Conferir o que ele recebe

Botão **Ver o que o agente recebe**. O texto vem de `chat.render_knowledge()`,
a mesma função que alimenta o prompt — a tela não monta a sua própria versão,
justamente para as duas não divergirem sem ninguém notar.

## Exportar e importar

**Exportar** baixa a base como Markdown, com as instruções de formato dentro
do próprio arquivo — quem for editar precisa das regras junto, não num manual
guardado em outro lugar. Serve para jogar numa LLM e pedir para ampliar.

**Importar** substitui a base inteira; não mescla. Mesclar por título parece
gentil e não é: renomear uma seção criaria uma cópia em vez de editar, e
ninguém entenderia por que a base dobrou. Exporte antes se quiser guardar o
que está no ar.

A troca roda em `chat.replace_knowledge()`, transação única. Em duas chamadas
separadas existiria uma janela com a base vazia — justamente quando o agente
mais inventaria.

A caixa **"importar tudo desligado"** vem marcada. Texto que passou por uma
LLM merece leitura antes de virar o que o agente afirma ao cliente.

O arquivo cita o teto recomendado: **12.000 caracteres ligados**, cerca de
3.200 tokens, ~US$ 0,006 por mensagem, ~US$ 6 a cada mil. Seção desligada não
custa nada.

### Quem transcreve o áudio é configurável

A rota de transcrição da OpenAI virou um formato: Groq e outros expõem o mesmo
caminho, o mesmo formulário e a mesma resposta. Por isso o endereço não está
cravado no código.

    AUDIO_API_KEY   a chave do provedor — sem ela, áudio vai para uma pessoa
    AUDIO_API_URL   padrão: https://api.groq.com/openai/v1/audio/transcriptions
    AUDIO_MODEL     padrão: whisper-large-v3-turbo

O padrão é a Groq porque o plano gratuito dela cobre com folga o volume de um
WhatsApp de atendimento — 2.000 requisições e 8 horas de áudio por dia — e roda
o Whisper large v3, que é maior que o `whisper-1` cobrado pela OpenAI.

Para trocar de provedor, duas linhas no `.env` e um restart:

    AUDIO_API_URL=https://api.openai.com/v1/audio/transcriptions
    AUDIO_MODEL=gpt-transcribe

Gratuito hoje não é contrato. A variável existe para o dia em que a política
mudar ser um restart, e não uma refatoração.

---

# Diretrizes por empresa — a tela Agente

Painel → **Agente**. É a camada 2 da tabela lá de cima, e a tela existe porque
"a IA responder condizente com o negócio de cada empresa" não é a mesma coisa
que "cada empresa escrever o próprio prompt".

A ordem da tela é a ordem do prompt, de propósito:

1. **Regras da plataforma** — só leitura. Estão ali para quem escreve as
   diretrizes saber com o que elas convivem, e para deixar claro que em
   conflito elas vencem.
2. **Diretrizes desta empresa** — apresentação, tom, o que ela pode explicar
   por conta própria, o que nunca dizer, quando chamar alguém, região,
   horário e um campo livre.
3. **O que perguntar antes de passar para a equipe** — a fila de qualificação.

## Por que campos, e não uma caixa de texto

Uma caixa de texto seria mais rápida de construir e pior de operar. Três
motivos, na ordem em que doem:

1. quem escreve um prompt inteiro apaga sem querer as linhas que impedem o bot
   de inventar preço — e o efeito só aparece semanas depois, num cliente que
   recebeu um valor que não existe;
2. as regras que fazem a ferramenta funcionar (não escrever texto junto de uma
   chamada de ferramenta, terminar sempre falando) parecem burocracia para
   quem não viu o bug, e são a primeira coisa a ser cortada;
3. suporte vira arqueologia de prompt alheio, e cada empresa passa a ser uma
   variante para depurar.

O campo livre existe — **Outras preferências** —, tem teto de 2.000 caracteres
e entra no fim, marcado como preferência da empresa. É válvula de escape, não
a porta principal.

## O bot tem nome

`company_profile.nome_do_bot`. Vazio continua sendo "bot", que é como sempre
foi.

Ele serve a dois lugares ao mesmo tempo, e é por isso que é um campo só:

- **no painel**, é a etiqueta de cada fala da automação. Antes era "BOT"
  cravado no código — o nome interno do sistema aparecendo num lugar onde se lê
  nome de quem atende;
- **no prompt**, é o primeiro bloco do perfil, antes até da apresentação da
  empresa. Um bot chamado Eddy que não sabe que se chama Eddy responde "sou o
  atendimento automático" a quem cumprimentou por "Eddy" — começa negando o
  próprio nome.

Ter nome não muda a regra da honestidade: perguntando se é uma pessoa ou um
robô, a resposta continua sendo que é um atendimento automático. O bloco do
nome diz isso explicitamente, senão as duas instruções pareceriam brigar.

## O tom vira frase, não rótulo

`tom` é `informal`, `neutro` ou `formal` no banco, e `render_company_profile`
troca isso por uma instrução:

> Formal e respeitoso. Trate por senhor ou senhora, e não use emoji nem gíria.

Mandar a palavra "formal" para o modelo e esperar que ele saiba o que fazer com
a próxima frase é economia no lugar errado.

## Empresa nova

`chat.create_company` passou a criar a linha de perfil em branco e a fila
mínima — `nome` e `interesse`. Fila vazia é comportamento válido (o bot
conversa e chama alguém sem qualificar), mas seria uma primeira impressão
ruim do produto.

## Conferir

O botão **ver como o agente recebe** mostra o texto montado pela mesma função
que alimenta o prompt. É o equivalente, nesta tela, ao painel de conferência
da Base.

## Horário: o único campo que a máquina lê

Os outros campos do perfil o modelo interpreta. Deste sai uma decisão, tomada
sem passar pelo modelo — e por isso ele é uma grade de sete dias, não uma
frase.

O bot atende 24 horas; a equipe, não. Até aqui uma escalada às onze da noite
dizia "vou chamar uma pessoa" e parava aí. Agora `/api/internal/escalate`
pergunta ao banco se a empresa está aberta e, se não estiver, emenda na
mensagem:

> Agora estamos fora do horário de atendimento, mas já deixei sua conversa na
> fila: um atendente entra em contato amanhã a partir das 08:00. Enquanto isso
> sigo por aqui — se der para ajudar em alguma coisa, é só dizer.

Quem escreve isso é o servidor, nunca o modelo: ele não sabe que horas são. O
prompt da plataforma passou a proibir explicitamente qualquer previsão de
quando alguém responde — inclusive "já já".

**"A partir das", e não "às"**: o banco sabe quando a empresa abre, não quando
alguém vai pegar esta conversa. A hora exata seria uma promessa feita em nome
de uma pessoa que ainda vai chegar — a mesma que o prompt proíbe o modelo de
fazer.

A última frase não é gentileza de despedida: é o que vai acontecer de fato na
próxima pergunta, e está descrito logo abaixo.

### O formato, e o que ele não cobre

```json
{"1": {"abre": "08:00", "fecha": "18:00"},
 "6": {"abre": "08:00", "fecha": "12:00"}}
```

Chave é o dia como o Postgres e o JavaScript contam: `0` é domingo. Dia
ausente é dia fechado. **Objeto vazio quer dizer 24 horas** — é assim que toda
empresa nasce, e é o que mantém quem nunca abriu a tela funcionando como
sempre funcionou.

Um intervalo por dia. Quem fecha para o almoço continua cadastrando
08:00–18:00: a pausa do almoço não deve fazer o bot dizer "só amanhã".
Expediente que atravessa a meia-noite não é aceito — `fecha` maior que `abre`
é regra de banco, porque na prática é erro de digitação.

O fuso é da empresa (`chat.company_profile.fuso`, padrão `America/Sao_Paulo`).
Errar o fuso é decidir "fechado" na hora errada, então ele é um select com os
cinco horários do Brasil, e não texto livre.

### O horário é da equipe, não do bot

A grade não fecha o atendimento: fecha só a parte humana dele. O bot atende as
vinte e quatro horas, todos os dias, e é isso que a tela do Agente promete a
quem preenche a grade.

O modelo, porém, não lia promessa nenhuma — recebia sete linhas de horário sob
um título e mais nada. Às onze da noite ele concluía o que qualquer um
concluiria: que estava fechado. Duas frases desfazem isso, uma em cada camada:

- no perfil da empresa, logo abaixo da grade — "é o horário das pessoas, não o
  seu; fora dele, siga atendendo igual";
- no prompt da plataforma, a seção **Você não fecha**, que vale mesmo quando a
  empresa não preencheu grade nenhuma e o bloco do horário nem é escrito.

Só quando for preciso uma pessoa é que o horário importa, e aí quem fala é o
servidor, com o aviso de quando a equipe volta.

### O bot espera junto

Faltava a outra metade da mesma promessa. Escalar deixa a conversa em
`human`/`pending`, e os dois webhooks só acionam a automação em modo `bot`; o
relógio que devolveria a conversa ao bot só corre em expediente, de propósito.
Somadas, as três coisas produziam isto: o cliente ouvia "um atendente entra em
contato amanhã a partir das 08:00" e, na pergunta seguinte, ouvia silêncio.
Nove horas de silêncio — inclusive para o que a base responde, e apesar de o
prompt mandar seguir respondendo depois de escalar.

Então **a fila fora do expediente passa a ser um estado em que o bot fala**.
Não é voltar atrás na escalada: a conversa continua `human`, continua
`pending`, continua contando espera e continua aparecendo na fila de manhã. O
que muda é quem responde enquanto não há ninguém para responder.

Quem decide é `chat.fila_fora_do_expediente(conversa)` — humano, **sem dono**,
não arquivada, e a empresa fechada. Sem dono é o que preserva a trava do
projeto: quem assumiu às dez da noite assumiu, e o bot não fala por cima. E a
trava é reavaliada no envio, não no começo do turno, então o atendente que
assume às 08:00 enquanto o modelo escreve ainda ganha um `409`.

Quatro lugares passaram a perguntar isso em vez de olhar só o `mode`:

| Onde | O que muda |
|---|---|
| os dois webhooks | encaminham ao n8n também nesse estado |
| `/api/internal/send` | a única exceção da trava do handoff |
| `/api/internal/escalate` | escalada de conversa que já está na fila volta a falar, em vez de sair calada |
| `/…/context` | devolve `podeResponder` e `emEspera`, que o workflow lê no lugar do `mode` |

Modo `bot` continua sendo o caminho de sempre e não gasta consulta nova: a
pergunta ao banco só acontece quando o modo já não é `bot`, que é a exceção.

No prompt, `emEspera` acende um bloco a mais — *uma pessoa já foi chamada*: o
agente segue atendendo, não repete o aviso que o servidor já deu, e não chama
`escalar_para_humano` de novo pelo motivo que já pôs a conversa na fila.

O aviso também não se repete do lado do servidor: uma segunda escalada na
mesma espera (um áudio ilegível às 22h10, por exemplo) manda só a fala do
agente. A janela de "já avisei" é `aguardando_desde` — saiu da fila e voltou, é
outra espera, e a hora mudou.

### Os prazos passam a correr só em expediente

Esta é a metade que faz a promessa valer. `devolver_ao_bot_minutos` está em 30:
sem mudar nada, a conversa que escalava às 22h voltava ao bot às 22h30, saía
da fila `pending` e de manhã não havia o que atender — a promessa se desfazia
meia hora depois de feita.

`chat.aplicar_prazos_de_conversa` ganhou `and p.aberta` em todos os relógios. O
prazo de inatividade passa a ser de inatividade **em expediente**: 30 minutos
de sexta às 17h45 vencem na segunda às 08:15, não no sábado de madrugada.

O prazo da fila (`devolver_da_fila_minutos`, descrito em
[07-fila-de-atendimento](07-fila-de-atendimento.md)) precisa de mais que isso.
Ele conta desde `aguardando_desde`, que é hora de relógio: a conversa que
escalou às 22h chega às 8h com dez horas de espera e venceria no primeiro
minuto do expediente — exatamente a conversa a quem o aviso de fora do horário
prometeu a manhã. Por isso o relógio da fila começa em
`greatest(aguardando_desde, ultima_abertura)`: a espera da madrugada não é
espera de atendimento.

### As funções

| Função | Para quê | Quem chama |
|---|---|---|
| `chat.empresa_aberta(id, quando)` | booleano cru | os prazos, e as duas abaixo |
| `chat.proxima_abertura(id, quando)` | o próximo instante de abertura | o painel, via a de baixo |
| `chat.ultima_abertura(id, quando)` | a abertura mais recente, olhando para trás | o relógio da fila |
| `chat.horario_de_atendimento(id)` | as duas respostas em JSON, com `assert_same_company` | `lib/horario.ts` |
| `chat.horario_em_texto(jsonb)` | a grade em português, para o prompt | `render_company_profile` |
| `chat.fila_fora_do_expediente(conversa, quando)` | a conversa espera na fila e a equipe só volta amanhã | os webhooks, `/send`, `/escalate`, `/context` |

A `authenticated` só são concedidas `horario_de_atendimento` e
`horario_em_texto`. As outras não conferem empresa nenhuma — são peças
internas, chamadas por quem já conferiu.

Formatar "amanhã a partir das 08:00" fica no TypeScript (`avisoForaDoHorario`),
porque é texto e não decisão: comparar a data de hoje com a da abertura **no
fuso da empresa** é o que transforma nove horas de diferença em "amanhã". É lá
também que mora a preposição do dia da semana — "no sábado", "na segunda-feira":
cinco dias são "-feira" e femininos, dois não.
