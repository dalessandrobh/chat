# Arquitetura

## Componentes

| Peça | Onde | Papel |
|---|---|---|
| **Painel Chat** | `chat.dsearch.com.br` (Next.js) | Inbox, handoff, templates, webhook da Meta |
| **n8n** | `n8n.dsearch.com.br` | Automações (o "bot") |
| **Supabase** | `supabase.dsearch.com.br` | Postgres, Auth, Realtime — schema `chat` |
| **Meta Cloud API** | graph.facebook.com | WhatsApp oficial |

## Princípio central: um único caminho de saída

O n8n **nunca** chama a Graph API direto. Ele chama
`POST /api/internal/send` no painel, que então fala com a Meta.

Isso não é burocracia — resolve três problemas de uma vez:

1. **Log completo.** Toda mensagem enviada vira linha em `chat.messages`,
   venha do bot ou de uma pessoa. Sem isso, o histórico no painel ficaria
   cego para o que o bot mandou.
2. **Regra da janela de 24h num lugar só.** Se cada workflow do n8n
   tivesse que lembrar de checar, uma hora alguém esquece.
3. **A trava do handoff.** É o que impede o bot de responder por cima do
   atendente.

## O fluxo de uma mensagem recebida

```
Cliente no WhatsApp
      │
      ▼
Meta Cloud API ──POST──► /api/webhooks/meta
                              │
                              ├─ 1. valida assinatura HMAC (X-Hub-Signature-256)
                              ├─ 2. deduplica por wamid em chat.webhook_events
                              ├─ 3. resolve_conversation() → contato + conversa
                              ├─ 4. grava em chat.messages
                              │      └─ trigger reabre a janela de 24h
                              │
                              └─ 5. conversa em modo bot?
                                     │
                        ┌────────────┴────────────┐
                       sim                       não
                        │                         │
                        ▼                         ▼
                 webhook do n8n            só aparece no inbox
                        │                  (humano responde)
                        ▼
              POST /api/internal/send
                        │
                        ▼
                 Meta Cloud API
```

## O handoff bot ↔ humano

O estado vive em `chat.conversations.mode`, com dois valores: `bot` ou
`human`. Como está no banco, vale para o webhook também — não é só
enfeite de tela.

| Ação | Como | Efeito |
|---|---|---|
| Agente assume | botão **Assumir conversa** → `chat.take_over()` | `mode='human'`, bot silenciado |
| Agente devolve | botão **Devolver ao bot** → `chat.hand_back()` | `mode='bot'`, automação volta |
| Bot escala sozinho | `POST /api/internal/escalate` | `mode='human'`, `status='pending'`, sem dono |
| Devolução automática | `bot_resume_at` + `chat.auto_hand_back_expired()` | volta ao bot no horário marcado |

Toda transição é registrada em `chat.handoff_events` — quem, quando e por quê.

**A trava:** com `mode='human'`, `/api/internal/send` responde `409` com
`reason: "human_takeover"`. Um workflow atrasado não consegue atropelar o
atendente no meio da conversa.

## Schema `chat`

```
channels          números WhatsApp (phone_number_id da Meta)
  └─ contacts     pessoas, únicas por (canal, wa_id)
       └─ conversations   1 por contato — mode, status, janela de 24h
            └─ messages   entrada e saída, de qualquer autor
templates         espelho local dos HSM da Meta
handoff_events    auditoria das trocas bot ↔ humano
webhook_events    payload cru + idempotência
inbox (view)      a lista pronta do painel, sem N+1
```

### Decisões que valem explicação

- **Schema `chat`, não `public`.** A VPS já tem o schema `dsearch`; manter
  cada projeto no seu evita colisão de nomes.
- **Segredos não ficam no banco.** `channels.token_ref` guarda só o *nome*
  da variável, nunca o token.
- **Cliente não insere em `messages`.** A RLS permite só `SELECT`. Mensagem
  sainte passa pela API, que fala com a Meta e só então grava — assim o
  painel nunca mostra mensagem que na verdade não saiu.
- **`webhook_events` com constraint única.** A Meta reentrega em caso de
  timeout; a barreira contra duplicata é do banco, não do código.
- **Template órfão vira `DISABLED`, não é apagado.** Mensagens antigas
  referenciam o template usado; apagar quebraria o histórico.
