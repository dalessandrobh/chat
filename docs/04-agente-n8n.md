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

## Testar

Mande mensagem de outro celular. Se a conversa estiver em atendimento humano
— e ela fica, sempre que você responde pelo aparelho — o agente não fala.
Clique em **Devolver ao bot** no painel primeiro.

Se algo falhar, o rastro está em **Executions** no n8n, nó a nó, com o que
entrou e o que saiu.
