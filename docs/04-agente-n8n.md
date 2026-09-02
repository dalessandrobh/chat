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
                            └── resposta ─▶ POST /api/internal/send
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
percorra os oito nós que precisam de credencial — `Mensagem recebida`,
`Buscar contexto`, `Responder`, `Avisar que não consegui ler`,
`Escalar (mídia)`, `escalar_para_humano`, `anotar_dados` e `Claude` — e
selecione de novo.
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

Está no nó `Agente`, em System Message, e é onde você vai mexer com o tempo.
A regra que mais importa:

> Você não sabe preço, prazo, condição de pagamento, promoção nem ficha
> técnica. Não estime, não dê faixa, não diga "em torno de".

Sem base de conhecimento, um modelo preenche lacuna com plausibilidade — e
preço plausível inventado vira problema comercial de verdade. Ele qualifica
(nome, cidade, casa ou piscina, quantas pessoas) e passa para uma pessoa
quando o assunto sai do genérico.

A Fase 4 troca essa restrição por uma base de conhecimento: aí ele responde
preço porque leu o seu, não porque inventou.

## A despedida sai pela ferramenta, não pelo agente

`escalar_para_humano` manda a mensagem de despedida **antes** de trocar o modo
para `human`, e é por isso que ela mora no endpoint e não no fluxo.

Se o agente escalasse primeiro e falasse depois, a fala esbarraria na própria
trava de handoff: o modo já seria `human`, `/api/internal/send` devolveria 409
e o cliente ficaria sem resposta nenhuma — escalado em silêncio. O texto está
no `jsonBody` do nó da ferramenta, e é lá que se edita.

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

O agente qualifica — nome, cidade, casa ou piscina, quantas pessoas — mas a
lista do que ainda falta **não** está escrita no System Message. Ela chega
pronta em `{{ $json.faltando }}`, vinda de `Buscar contexto`.

Por que assim: com a lista fixa no prompt, o agente relia a conversa a cada
mensagem para adivinhar o que já tinha perguntado. Quando o cliente ignorava,
o dado continuava faltando e a pergunta voltava idêntica — cinco vezes
seguidas num teste de dez mensagens.

Agora o dado respondido sai da fila de verdade:

1. o cliente responde qualquer um dos quatro itens;
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

Mexer na lista de perguntas é mexer em `app/src/lib/qualificacao.ts`, não no
prompt. O campo `pessoas` só entra na fila quando o uso é residência.

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
