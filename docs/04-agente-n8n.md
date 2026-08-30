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
percorra os sete nós que precisam de credencial — `Mensagem recebida`,
`Buscar contexto`, `Responder`, `Avisar que não leio áudio`,
`Escalar (mídia)`, `escalar_para_humano` e `Claude` — e selecione de novo.
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
