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

## Canais: cadastrar, trocar o número, pausar

A tela **Canais** faz as três operações, todas restritas a administrador.

**Novo número** cria a instância na Evolution já com o webhook apontado para
`http://chat-app:3000/api/webhooks/evolution` — endereço da rede interna do
Docker, sem passar pela internet — e grava a linha em `chat.channels`. O
pareamento é um segundo passo, no cartão: quem cadastra nem sempre é quem está
com o celular na mão. Se a Evolution recusar a criação, a linha recém-gravada é
apagada; instância órfã ocuparia o nome para sempre, e nome de instância é
único.

**Trocar número** desconecta o aparelho e mantém o canal. Conversas, contatos,
campanhas e templates continuam apontando para a mesma linha, e o próximo QR
pareia outro celular no lugar. É essa a diferença para cadastrar um canal novo:
trocar mantém a história, cadastrar começa do zero.

**Pausar** cala o que sai sozinho — o bot não responde e as campanhas não
disparam por aquele número. A mensagem continua sendo gravada e aparecendo no
painel, e quem estiver lá responde na mão: pausar tira o robô do ar, não o
cliente.

A trava vive em dois lugares, e é de propósito: no webhook, para o bot, e
dentro de `chat.claim_next_send()`, para as campanhas. As campanhas disparam
pelo banco e precisam parar mesmo que alguém rode um script na mão.

> `chat.channels.is_active` existia desde o primeiro dia e não era lido por
> ninguém. Dava para desligar um número no banco e ele continuar atendendo e
> disparando.


## Multiempresa: como o isolamento funciona

Uma pessoa pertence a **uma** empresa. Quem atende duas tem dois logins. Essa
decisão é o que torna o resto simples: não existe "empresa ativa na sessão",
não existe seletor e não existe tabela de vínculo — a empresa é a do usuário
logado.

```
chat.current_company()  →  a empresa do agente ativo em auth.uid(), ou nulo
```

Toda política de acesso compara `company_id = chat.current_company()`. Quem não
é agente ativo recebe nulo, e comparação com nulo é falsa: a política nega
sozinha, sem precisar de um "e existe agente" em cada uma.

**Nenhuma política tem exceção para dono de plataforma.** Toda porta de fuga
dentro da regra de acesso é um vazamento esperando. Enxergar a conta do cliente
para dar suporte será superfície separada e auditada, não um `or` no meio da
política.

### As três camadas

| Camada | O que protege | Onde |
|---|---|---|
| Coluna | toda linha tem dono | `company_id` em 12 tabelas |
| Política | o navegador só lê o que é dele | 19 políticas + `security_invoker` nas views |
| Função | o servidor carimba o dono certo | as `security definer` de 0017 |

A terceira camada é a que não se vê. Funções `security definer` rodam com os
direitos de quem as criou e **passam por cima de qualquer política** — é como
elas gravam em nome do webhook, que não tem usuário logado. Ali a separação é
responsabilidade do corpo da função:

- quem grava carimba a empresa **derivada do canal ou da conversa**, nunca de
  um parâmetro vindo de fora;
- quem age em nome de alguém logado chama `chat.assert_same_company()` antes.

### A view que ignorava a RLS

View sem `security_invoker` roda com os direitos de quem a criou. Medido antes
da correção: um usuário logado que não era agente de ninguém via **0 linhas em
`chat.conversations` e 7 em `chat.inbox`**, com nome, telefone e prévia da
conversa. Isso já valia com uma empresa só.

Ao criar view nova sobre tabela com RLS, `security_invoker = true` não é
opcional.

### Testar

`supabase/tests/isolamento.sql` cria duas empresas fantasmas, afirma que
nenhuma enxerga ou age sobre a outra, e desfaz tudo no fim. Roda em uma
transação e para no primeiro `FALHOU`.

Vale rodar depois de qualquer mudança em política, view ou função
`security definer`.


## Credencial por canal

Endereço e chave da Evolution — e o token do webhook — moravam em variável de
ambiente do servidor: uma empresa, cravada no processo. Agora moram na linha do
canal.

O valor não fica na coluna. Fica no cofre do Postgres (`supabase_vault`), e a
coluna `channels.secrets` guarda só o mapa `nome → id`. Um `pg_dump` leva o
texto cifrado; a chave do cofre não está no dump.

```
chat.set_channel_secret(canal, nome, valor)   grava — só admin da empresa dona
chat.channel_credentials(canal)               lê tudo decifrado — só service_role
chat.channel_secret_names(canal)              o que está preenchido — para a tela
```

`channel_credentials` **não é concedida a `authenticated`**. O painel sabe
quais credenciais existem, nunca o que são: não há caminho que devolva uma
credencial para o navegador, nem para o administrador que a digitou.

### Não existe queda para o ambiente

Canal sem credencial falha com erro claro. A alternativa — cair no valor do
ambiente — mandaria a mensagem da empresa B pelo número da empresa A sem
ninguém notar.

O ambiente ainda tem `EVOLUTION_BASE_URL` e `EVOLUTION_API_KEY`, e eles são
usados **uma vez**: quando um canal é criado sem servidor próprio, o valor é
copiado para a linha dele. Depois disso o canal é autossuficiente. No dia em
que o padrão mudar, o canal antigo continua falando com o servidor onde a
sessão dele existe.

### O webhook carrega o canal na URL

```
/api/webhooks/evolution/<id-do-canal>
```

É assim que se sabe de quem é o evento **antes** de conferir o token — e cada
canal confere o seu. Medido: token do canal A na URL do canal B devolve 401.

O caminho sem id continua aceito para instâncias antigas; ali o canal é
descoberto pelo nome da instância no corpo, e o token conferido é o daquele
canal do mesmo jeito. **Em nenhum dos dois caminhos existe token global** — o
antigo `EVOLUTION_WEBHOOK_TOKEN` não autoriza mais nada.

### O que ainda falta

O cliente da Meta continua lendo o token do ambiente. Não há canal da via
oficial hoje, e enviar por um sem credencial própria falha com erro explícito
em vez de usar a conta da plataforma calado. Some quando o cliente da Meta
receber a credencial do canal, como o da Evolution já recebe.


## Id de provedor não identifica empresa

Confirmação de entrega chega com o id da mensagem no provedor, e é por ele que
a linha era encontrada:

```
update messages set status = 'read' where wa_message_id = <veio de fora>
```

Com uma Evolution só, da plataforma, isso era inofensivo. Depois da Fase 4 cada
empresa pode trazer o próprio servidor — e um servidor comprometido mandaria o
id de outra empresa e mexeria na linha dela. O evento é autenticado por canal,
mas o **conteúdo** dele não é confiável.

As quatro atualizações desse tipo passaram a levar a empresa junto, derivada do
canal que mandou o evento. É a mesma regra da Fase 3, aplicada onde ela ainda
não estava: o que vem de fora não escolhe em nome de quem se age.

Na via oficial o `phone_number_id` passou a viajar no evento de status pelo
mesmo motivo — sem ele não havia como amarrar a confirmação a uma empresa.


## Como uma empresa entra, e como o suporte olha

### Quem chega sozinho

Cadastro aberto na tela de login. Depois de confirmar o e-mail, a pessoa cai em
`/comecar`, dá um nome à empresa e entra como administradora dela.

`chat.create_company()` recusa quem já tem empresa — sem isso o cadastro viraria
um jeito de encher o banco. E quem foi **convidado** não passa por essa tela:
convidado já nasce com empresa e vê "acesso pendente" até o administrador
liberar em Usuários.

A ponte antiga continua no lugar: enquanto existir **uma** empresa, o gatilho
`handle_new_user` põe o novo cadastro nela. Na segunda ele para de adivinhar.

### O suporte entra por outra porta

Nenhuma política de acesso ganhou um `or chat.is_platform_owner()`. Isso é
deliberado e o teste de isolamento **afirma** que continua assim: qualquer
política que passe a mencionar `is_platform_owner` quebra a suíte.

A visão ampla vive fora da RLS:

| | |
|---|---|
| `chat.platform_owners` | quem opera a instalação |
| `chat.platform_overview()` | medida por empresa — só `service_role` |
| `chat.platform_access_log` | quem olhou, o quê e quando |

A tela `/plataforma` confere quem está pedindo, usa a chave de serviço de
propósito e **registra o próprio acesso**. O que ela mostra é medida, não
conteúdo: contagem de equipe, canais, conversas e mensagens. Ler conversa de
cliente é outra decisão e vai precisar de outra porta.

Quem não é dono da plataforma é mandado para o inbox — não descobre que a tela
existe.


## Nada de identidade cravado no código

O nome da empresa aparecia em três lugares, todos como texto fixo: o começo do
prompt do agente, a despedida de quando o atendente devolve a conversa, e a
constante `EMPRESA` em `lib/handoff-messages.ts`. Com várias empresas no mesmo
painel, isso faria o cliente de uma ser atendido em nome de outra.

Agora o nome vem do banco:

- `/api/internal/conversations/:id/context` devolve `empresa`, e o prompt monta
  a primeira frase com `{{ $json.empresa }}`;
- a despedida recebe o nome de quem chama, junto da conversa.

O resto da persona — tom, regras, o que pode e o que não pode dizer — continua
na base de conhecimento, que já é por empresa. Não criei coluna para isso: seria
duplicar o que a seção "Regras gerais" já faz.

### Ajuste sem linha não é ajuste desligado

`lib/ajustes.ts` lia `chat.settings` com a chave de serviço e **sem filtrar por
empresa** — com duas, leria a linha de qualquer uma, ou quebraria por trazer
duas. Agora filtra, e trata ausência como o padrão do ajuste: empresa que nunca
mexeu em "ler imagens" tem a leitura **ligada**, não desligada.

A gravação virou upsert pelo mesmo motivo: um `update` em empresa sem linha
mudaria zero linhas em silêncio, e a tela diria "salvo".


## Prazos da conversa

Dois relógios por empresa, em Ajustes, ambos **desligados por padrão** — ligar
um relógio que mexe em conversa de cliente sem alguém ter pedido é pior do que
não ter o relógio.

| Ajuste | O que faz | Avisa o cliente? |
|---|---|---|
| Devolver ao bot | minutos parados em atendimento humano até voltar para o bot | **sim** |
| Encerrar por inatividade | minutos sem ninguém falar até sair da lista | não |

A devolução avisa porque alguém pediu uma pessoa e ninguém veio: voltar ao robô
calado é pior do que dizer. O encerramento não avisa porque é arquivo interno —
"encerramos seu atendimento" às três da manhã transforma faxina em notificação.

### Encerrar é arquivar, não terminar

O gatilho `sync_conversation_on_message` reabre a conversa quando o contato
volta a escrever. Isso vale desde o primeiro dia e é o que torna a ação segura:
no pior caso a pessoa escreve de novo e tudo volta.

Por isso o cliente **não** tem um comando de encerrar, e não deve ter: ele já
tem o gesto natural, que é parar de escrever — e é justamente isso que o
relógio lê.

### Fechar sem sair de `human` seria uma armadilha

Encerrar também devolve a conversa ao bot, mesmo quando o prazo de devolução
não correu. Sem isso: a conversa fecha em modo humano, o contato escreve, o
gatilho reabre — e o bot continua calado, porque o modo é `human`. Ninguém
responde e nada aparece como erro.

`close_conversation` e o relógio fazem os dois movimentos juntos, e o teste de
isolamento afirma que nenhuma conversa termina fechada em modo humano.

### `pending` depois de voltar ao bot

`pending` quer dizer "esperando atendente". Devolvida ao bot, a conversa não
espera mais ninguém — ficar assim a manteria marcada como fila na tela sem
estar em fila nenhuma. A devolução automática **e** a manual passam a voltar
para `open`; a manual tinha esse defeito desde a Fase 1.

### O que existia e nunca rodou

`chat.auto_hand_back_expired()` está no projeto desde a primeira migração e
nenhuma linha de código a chama. Ela depende de `bot_resume_at`, preenchido só
quando alguém assume a conversa escolhendo prazo no seletor — o campo estava
nulo nas onze conversas. Continua ali para o prazo por conversa; o relógio novo
é o prazo da empresa, que vale para toda conversa parada.
