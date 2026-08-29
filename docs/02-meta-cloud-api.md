# Configurar a WhatsApp Cloud API (Meta)

Este é o único passo que depende inteiramente de você — envolve conta
comercial, número de telefone e aprovação da Meta.

## 1. Pré-requisitos

- Conta no [Meta for Developers](https://developers.facebook.com)
- Um **Meta Business Manager** verificado (business.facebook.com)
- Um número de telefone **que não esteja em uso no WhatsApp comum nem no
  WhatsApp Business app**. Se estiver, apague a conta no aparelho antes.

## 2. Criar o app

1. developers.facebook.com > **My Apps** > **Create App**
2. Tipo: **Business**
3. Dentro do app: **Add Product** > **WhatsApp** > **Set up**

Na tela *API Setup* você já vê dois valores que vão para o `.env`:

| Tela da Meta | Variável |
|---|---|
| Phone number ID | `META_PHONE_NUMBER_ID` |
| WhatsApp Business Account ID | `META_WABA_ID` |

## 3. Token permanente (não use o temporário)

O token que aparece na tela *API Setup* **expira em 24 horas**. Para produção:

1. business.facebook.com > **Configurações do negócio** > **Usuários** >
   **Usuários do sistema**
2. **Adicionar** > nome "chat-api" > função **Administrador**
3. **Adicionar ativos** > selecione seu app do WhatsApp > marque
   **Controle total**
4. **Gerar novo token** > escolha o app > permissões:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Marque **Nunca expira** e copie o token

Esse valor vai em `META_ACCESS_TOKEN`.

> Guarde bem: a Meta mostra o token uma única vez.

## 4. App Secret

App > **Settings** > **Basic** > campo **App Secret** > *Show*.

Vai em `META_APP_SECRET`. O painel usa isso para validar a assinatura
`X-Hub-Signature-256` de todo webhook — sem ele, qualquer um poderia
injetar mensagens falsas no seu sistema.

## 5. Cadastrar o webhook

Com o painel já publicado em `https://chat.dsearch.com.br`:

1. App > **WhatsApp** > **Configuration** > **Webhook** > **Edit**
2. **Callback URL**: `https://chat.dsearch.com.br/api/webhooks/meta`
3. **Verify token**: o mesmo valor que está em `META_WEBHOOK_VERIFY_TOKEN`
4. **Verify and save** — a Meta faz um GET e espera receber o `hub.challenge`
   de volta. Se der erro, o painel ainda não está no ar ou o token não bate.
5. Em **Webhook fields**, assine:
   - `messages` — mensagens recebidas e status de entrega
   - `message_template_status_update` — aprovação/recusa de templates

## 6. Cadastrar o canal no banco

O painel precisa saber qual `phone_number_id` pertence a qual canal:

```sql
insert into chat.channels (name, waba_id, phone_number_id, display_phone_number)
values ('Principal', '<META_WABA_ID>', '<META_PHONE_NUMBER_ID>', '+55...');
```

Sem essa linha o webhook rejeita as mensagens com
*"Mensagem para phone_number_id desconhecido"*.

## 7. Importar os templates existentes

No painel, aba **Templates** > **Sincronizar com a Meta**. Isso puxa tudo
que já existe na sua WABA.

## Sobre a janela de 24 horas

Regra da Meta, não do sistema: você só pode mandar **texto livre** dentro de
24h após a última mensagem do cliente. Fora disso, apenas **template
aprovado**.

O painel reflete isso: a caixa de texto desabilita sozinha e a lista mostra
"⏱ janela de 24h expirada". Não é bug.

## Limites de template

- Nome: só minúsculas, números e `_`
- Toda variável `{{1}}` exige um **exemplo** — a causa nº 1 de reprovação
- `MARKETING` é analisado com mais rigor que `UTILITY`
- Aprovação costuma sair em minutos, mas pode levar até 24h
