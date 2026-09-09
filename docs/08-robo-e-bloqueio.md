# Quando do outro lado não há ninguém

Duas defesas para o mesmo tipo de problema: a conversa que não vai parar por
conta própria. A primeira é automática e reversível; a segunda é uma decisão de
gente.

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

## O robô do outro lado

### O que denuncia a máquina

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

### O que acontece ao detectar

Calar, e só. `conversations.silenciada_em` recebe o instante e
`silenciada_motivo` a frase que explica. Os dois webhooks — Meta e Evolution —
param de acionar o n8n para essa conversa.

**Nenhuma mensagem de despedida.** "Percebi que você é um robô, tchau" seria
mais uma volta no laço, e o laço aceita qualquer uma. O teste de isolamento
afirma isso contando as saídas antes e depois.

A conversa continua na lista, com a etiqueta 🤖 CALADA e o motivo no title.
Nada é escondido de quem atende: se for engano, a pessoa vê e desfaz.

### Reativar

Calar é automático; descalar não é. O botão **Reativar o bot** chama
`chat.reativar_bot`, que limpa as duas colunas e carimba `bot_reativado_em`.

Esse marco d'água é o que dá sentido à reativação: sem ele, a detecção olharia
a mesma repetição de antes e calaria tudo de novo no segundo seguinte. Depois
de reativar, só conta o que vier a partir dali.

## Bloquear o número

Calar o bot resolve o robô do outro lado, mas a conversa continua na lista e o
número continua escrevendo. Para o que ninguém quer nem ver — spam, robô de
prospecção, engano insistente — o bloqueio tira o número da frente de todo
mundo.

**Qualquer atendente ativo bloqueia e desbloqueia**, sem distinção de papel.
Não é decisão de gestão: é de quem está com a conversa aberta na tela às onze
da noite. A tela fica em **Bloqueios**, no menu, e o botão também está na barra
da conversa.

Bloquear faz três coisas, e nenhuma delas apaga nada:

1. grava o número em `chat.blocked_numbers`, com motivo e autor;
2. tira a conversa do caminho — modo bot, sem dono, encerrada — para nenhum
   relógio de prazo encostar nela;
3. carimba `conversations.bloqueado_em`, que é o que a view `chat.inbox` e os
   dois webhooks já olham.

Desbloquear apaga a linha e limpa o carimbo. A conversa volta à lista com o
histórico inteiro, ainda encerrada: se a pessoa escrever de novo, o gatilho de
sempre reabre. Ressuscitá-la ali encheria a fila com conversa que ninguém pediu
de volta.

### O 9 que a operadora acrescentou

O WhatsApp guarda o mesmo celular como `553196546236` e `5531996546236`,
conforme a época e o aparelho — esta base tem os dois formatos. Bloquear uma
forma e deixar a outra passar seria um bloqueio que não bloqueia.

`chat.chave_de_numero` reduz tudo a país + DDD + os oito dígitos finais, e
aceita o que a pessoa digitar: com ou sem o 9, com ou sem o código do país, com
parênteses e traço. Dez ou onze dígitos soltos ganham o `55` na frente, porque
é um painel brasileiro e exigir o código do país seria transformar um bloqueio
em pegadinha. O preço é um número estrangeiro de onze dígitos digitado sem o
país virar uma chave brasileira — inofensivo, porque a chave só precisa ser
consistente consigo mesma, e a tela mostra o resultado formatado.

### Bloqueio preventivo

Um número pode ser bloqueado antes de escrever pela primeira vez. Como a
conversa nasce depois, quem reconcilia é o mesmo gatilho de entrada que cuida
da detecção de robô: ele carimba `bloqueado_em` na primeira mensagem, e o
limpa se o bloqueio tiver saído. A lista de bloqueios é a verdade; a coluna é a
cópia que os dois webhooks conseguem ler barato.

## Onde isso mora

| Peça | Papel |
|---|---|
| `chat.conversa_automatica(uuid)` | decide, e devolve o motivo em português |
| `chat.silenciar_conversa_automatica()` | gatilho em `chat.messages`, só para entradas, só em modo bot |
| `chat.reativar_bot(uuid)` | desfaz, com `assert_same_company` |
| `silenciada_em` na view `chat.inbox` | etiqueta na lista e faixa na barra da conversa |
| `chat.chave_de_numero(text)` | a forma canônica do número, sem o 9 opcional |
| `chat.bloquear_numero(text, text)` / `chat.desbloquear_numero(text)` | bloqueio, com `chat.current_company()` decidindo a empresa |
| `bloqueado_em` na view `chat.inbox` | o `where` que some com a conversa da lista |

O gatilho fica no banco, e não no webhook, porque são dois webhooks: pôr a
regra em um deles seria deixá-la faltando no outro na primeira distração.
