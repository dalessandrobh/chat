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

## Versão mínima do n8n

**1.123.75 ou mais recente.** O nó do Claude é um invólucro do LangChain, e as
versões antigas mandavam `top_p: -1` em toda chamada. Nenhum modelo Claude
atual aceita parâmetro de amostragem — a resposta é `400 top_p is deprecated
for this model`, e não há como desligar isso pelo workflow. A partir da 1.123
esses campos nascem indefinidos e somem do JSON.

Pelo mesmo motivo o nó `Claude` não tem `temperature` nem `topP` configurados.
Não adicione: qualquer um dos dois derruba a chamada.

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

### Cuidado com o modo Expression

Campo cujo valor começa com `=` é tratado como expressão pelo n8n. Uma chave
de API colada num campo em modo Expression vira `=sk-ant-...`, o n8n tenta
avaliar aquilo como código e manda o resultado para a API. O erro que aparece
é de autenticação, e a chave está perfeita — o problema é o `=`.

### Não mexa no campo Model

A lista de modelos desta versão do n8n é anterior ao Claude 5, então o valor
vai como expressão (`=claude-sonnet-5`). Escolher pelo dropdown troca por um
modelo antigo. Se precisar mudar, edite a expressão.

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
