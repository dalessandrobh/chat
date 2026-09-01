# E-mails de autenticação

Quem manda os e-mails de cadastro, convite e recuperação de senha é o **GoTrue**,
o serviço de autenticação do Supabase — não o painel. Por isso o texto e o
destino deles não estão no código do Chat: estão em variáveis de ambiente do
serviço, editáveis no Coolify.

O Supabase auto-hospedado tem **um GoTrue por instalação**. Como esta instalação
atende o Chat e o dsearch, os dois compartilham esses e-mails: não existe
configuração por schema nem por projeto. Enquanto foi do dsearch, quem se
cadastrava no Chat recebia "Confirme seu e-mail — dsearch" e era mandado para
`dsearch.com.br` depois de confirmar.

## Os modelos moram no painel

`app/public/email/` — servidos em `https://chat.dsearch.com.br/email/*.html`.

| Arquivo | Quando é usado |
|---|---|
| `confirmacao.html` | cadastro novo, antes de a conta valer |
| `recuperacao.html` | "esqueci minha senha" |
| `convite.html` | convite enviado pelo Supabase |

O GoTrue substitui `{{ .ConfirmationURL }}`, `{{ .Email }}` e `{{ .SiteURL }}`.
O estilo fica em atributo `style` de propósito: cliente de e-mail ignora folha
externa, e boa parte deles ignora a tag `<style>` também.

Editar o texto é editar o arquivo e fazer deploy do painel — não precisa mexer
no Coolify nem reiniciar o Supabase, porque o GoTrue busca o modelo pela URL a
cada envio.

## O convite do painel não passa por aqui

`POST /api/agents` cria o usuário com `email_confirm: true` e devolve a senha
uma vez, na tela. **Nenhum e-mail é enviado.** O `convite.html` só entra em cena
se alguém usar o convite do próprio Supabase.

Ou seja: operar só por convite nunca dispara e-mail nenhum.

## As variáveis, no Coolify

Serviço do Supabase → Environment Variables. O Coolify mantém cada uma em duas
formas, com e sem o prefixo `GOTRUE_`; **as duas precisam bater**.

    SITE_URL                      https://chat.dsearch.com.br
    URI_ALLOW_LIST                https://chat.dsearch.com.br/**,https://dsearch.com.br/**
    SMTP_SENDER_NAME              Chat
    MAILER_SUBJECTS_CONFIRMATION  Confirme seu e-mail — Chat
    MAILER_SUBJECTS_RECOVERY      Redefinir sua senha — Chat
    MAILER_SUBJECTS_INVITE        Convite para o Chat
    MAILER_SUBJECTS_MAGIC_LINK    Seu link de acesso — Chat
    MAILER_SUBJECTS_EMAIL_CHANGE  Confirme a alteração de e-mail — Chat
    MAILER_TEMPLATES_CONFIRMATION https://chat.dsearch.com.br/email/confirmacao.html
    MAILER_TEMPLATES_RECOVERY     https://chat.dsearch.com.br/email/recuperacao.html
    MAILER_TEMPLATES_INVITE       https://chat.dsearch.com.br/email/convite.html

Depois, **Restart** no serviço do Supabase.

### O que não é só cosmético

`SITE_URL` era `https://dsearch.com.br`. É para onde o link de confirmação leva
depois de validar — quem se cadastrasse no Chat confirmava o e-mail e caía no
outro site. E `URI_ALLOW_LIST` não continha o endereço do Chat, então nem
adiantaria mandar o link para cá: o GoTrue recusa redirecionar para destino fora
da lista.

A lista fica com os dois endereços para o dsearch continuar funcionando enquanto
existir.

### O remetente continua sendo `nao-responda@dsearch.com.br`

Trocar o endereço exige que o novo domínio esteja verificado no Resend. O nome
que aparece na caixa de entrada é o `SMTP_SENDER_NAME`, e esse muda sem
verificação nenhuma. Se quiser o endereço no domínio do Chat, verifique
`chat.dsearch.com.br` no Resend antes.
