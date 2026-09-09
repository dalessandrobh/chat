# Quando do outro lado há outro robô

Um atendimento automático de outra empresa entrou no número da Eco. O padrão
dele, tirado da conversa real:

```
eles → "Esse atendimento foi encerrado. Para iniciar um novo, mande uma mensagem"
nós  → responde
eles → "Aguarde um momento enquanto transferimos para um especialista"
eles → "Seu protocolo de atendimento é: 28974"
eles → "Esse atendimento foi encerrado..."            ← e recomeça
```

Protocolos 28974 → 28975 → 28984 em quinze minutos. Cada volta gasta uma
chamada de modelo, uma mensagem paga e um protocolo no sistema deles. Ninguém
do outro lado vai desistir: não há ninguém do outro lado.

## O que denuncia a máquina

A repetição literal, não o assunto.

Gente repete "oi" e repete a mesma pergunta — nesta base, no máximo duas vezes.
Robô repete a frase inteira, com o número do protocolo como única diferença, e
responde em segundos a qualquer hora. Por isso o texto é normalizado **sem
dígitos**: "protocolo 28974" e "protocolo 28975" são a mesma frase dita duas
vezes.

`chat.conversa_automatica(conversa)` devolve o motivo, ou nulo. Cala quando as
três condições valem juntas:

| Condição | Valor | Por quê |
|---|---|---|
| entradas na conversa | ≥ 6 | conversa curta ainda não é padrão |
| repetição da mesma frase normalizada, nas últimas 12 entradas | ≥ 3 | o maior valor observado em conversa humana foi 2 |
| entradas chegadas até 90s depois de uma fala nossa | ≥ 3 | pessoa que responde em segundos, sempre, é programa |

As três andam juntas de propósito. Repetição sozinha pega quem mandou "bom dia"
três vezes; pressa sozinha pega quem digita rápido. Só as três juntas descrevem
algo que não vai parar por conta própria.

Há ainda uma rede de segurança independente do conteúdo: **20 respostas do bot
numa hora** na mesma conversa. Seja lá o que esteja acontecendo, aquilo não é
atendimento.

## O que acontece ao detectar

Calar, e só. `conversations.silenciada_em` recebe o instante e
`silenciada_motivo` a frase que explica. Os dois webhooks — Meta e Evolution —
param de acionar o n8n para essa conversa.

**Nenhuma mensagem de despedida.** "Percebi que você é um robô, tchau" seria
mais uma volta no laço, e o laço aceita qualquer uma. O teste de isolamento
afirma isso contando as saídas antes e depois.

A conversa continua na lista, com a etiqueta 🤖 CALADA e o motivo no title.
Nada é escondido de quem atende: se for engano, a pessoa vê e desfaz.

## Reativar

Calar é automático; descalar não é. O botão **Reativar o bot** chama
`chat.reativar_bot`, que limpa as duas colunas e carimba `bot_reativado_em`.

Esse marco d'água é o que dá sentido à reativação: sem ele, a detecção olharia
a mesma repetição de antes e calaria tudo de novo no segundo seguinte. Depois
de reativar, só conta o que vier a partir dali.

## Onde isso mora

| Peça | Papel |
|---|---|
| `chat.conversa_automatica(uuid)` | decide, e devolve o motivo em português |
| `chat.silenciar_conversa_automatica()` | gatilho em `chat.messages`, só para entradas, só em modo bot |
| `chat.reativar_bot(uuid)` | desfaz, com `assert_same_company` |
| `silenciada_em` na view `chat.inbox` | etiqueta na lista e faixa na barra da conversa |

O gatilho fica no banco, e não no webhook, porque são dois webhooks: pôr a
regra em um deles seria deixá-la faltando no outro na primeira distração.
