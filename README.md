# Chat

Plataforma de automação e atendimento de WhatsApp sobre a **Meta Cloud API**
(oficial), com painel próprio para conversas e templates.

> Nome provisório. O produto ainda vai ser batizado.

## O que faz

- **Bot no n8n** responde automaticamente
- **Atendente assume** a conversa quando quiser, e o bot fica mudo
- **Devolve ao bot** com um clique, ou automaticamente depois de X minutos
- **Templates da Meta** criados, submetidos e monitorados pelo painel
- **Janela de 24h** controlada pelo sistema, não pela memória do atendente

## Estrutura

```
app/                    Painel Next.js 15 (inbox, templates, APIs, webhook)
infra/n8n/              Docker Compose do n8n
supabase/migrations/    Schema `chat` (SQL)
n8n-workflows/          Workflows prontos para importar
docs/                   Arquitetura, setup da Meta, deploy
```

## Documentação

| Documento | Para quê |
|---|---|
| [docs/01-arquitetura.md](docs/01-arquitetura.md) | Como as peças se encaixam e por quê |
| [docs/02-meta-cloud-api.md](docs/02-meta-cloud-api.md) | Tirar as credenciais na Meta |
| [docs/03-deploy.md](docs/03-deploy.md) | Subir e operar |

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind · Supabase (Postgres + Auth +
Realtime) · n8n · WhatsApp Cloud API

## Estado

| Peça | Status |
|---|---|
| Schema `chat` no Supabase | ✅ aplicado e testado |
| n8n em n8n.dsearch.com.br | ✅ no ar com SSL |
| Painel (código + build) | ✅ compila, testado ponta a ponta |
| Painel publicado | ⏳ falta DNS `chat.dsearch.com.br` |
| Credenciais da Meta | ⏳ ver docs/02 |
