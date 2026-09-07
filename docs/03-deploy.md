# Deploy e operação

## Estado atual

| Serviço | URL | Status |
|---|---|---|
| n8n | https://n8n.dsearch.com.br | ✅ no ar, SSL válido |
| Schema `chat` | Supabase existente | ✅ aplicado e testado |
| Painel Chat | https://chat.dsearch.com.br | ⏳ falta DNS + deploy |

## n8n

Sobe com Docker Compose na rede `coolify`, então o Traefik do Coolify
roteia e emite o SSL automaticamente.

```bash
cd /root/projetos/chat/infra/n8n
docker compose ps            # estado
docker compose logs -f n8n   # logs
docker compose restart n8n   # reiniciar
docker compose down          # parar (SEM -v, senão apaga os dados)
```

### Primeiro acesso

Abra https://n8n.dsearch.com.br e crie a conta de dono — o n8n pede isso
na primeira visita. **Faça já**, antes que alguém ache a URL.

### Importar o workflow

**Workflows** > **Import from File** > `n8n-workflows/01-atendimento-base.json`

Depois, no nó *Mensagem recebida*, crie a credencial **Header Auth**:
- Name: `Authorization`
- Value: `Bearer <CHAT_SERVICE_TOKEN>` (o mesmo valor do `.env` do painel)

### Atualizar versão

Troque a tag em `docker-compose.yml` e:
```bash
docker compose pull && docker compose up -d
```

> ⚠️ `N8N_ENCRYPTION_KEY` está em `infra/n8n/.env`. Se perder essa chave,
> todas as credenciais salvas nos workflows viram lixo. Copie para um cofre.

### Adotar no Coolify (opcional)

Hoje o n8n roda por Compose direto, fora da UI do Coolify — funciona igual,
mas sem backup automático e sem a tela de logs. Para migrar, use
`infra/n8n/docker-compose.coolify.yml`, que já está no formato de variáveis
mágicas do Coolify (`SERVICE_FQDN_*`, `SERVICE_PASSWORD_*`).

## Painel Chat

### 1. DNS (bloqueia o resto)

Crie um registro **A**:
```
chat.dsearch.com.br  →  145.223.95.127
```

### 2. Deploy no Coolify

1. **+ New Resource** > **Private Repository** (ou **Dockerfile**)
2. Base directory: `/app`, Dockerfile: `Dockerfile`
3. Domínio: `https://chat.dsearch.com.br`
4. Porta: `3000`
5. Environment Variables: copie de `app/.env.example` e preencha

> **Atenção no build:** `NEXT_PUBLIC_SUPABASE_URL` e
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` precisam existir como **Build Args**,
> não só em runtime — o Next embute esses valores no bundle do browser
> durante o build.

### 3. Usuários e acesso

O painel usa o Supabase Auth — **o mesmo do projeto dsearch**, já que a
instância é compartilhada. Quem já tem login no dsearch entra no Chat com
a mesma senha.

Por isso, agente novo nasce **inativo** (`chat.agents.is_active = false`).
Sem isso, qualquer cadastro no dsearch viraria um atendente com acesso às
conversas. Para liberar alguém:

```sql
update chat.agents set is_active = true, role = 'agent'
 where email = 'pessoa@exemplo.com';
```

Papéis: `owner` e `admin` podem criar templates; `agent` só atende;
`viewer` só lê. Quem entra sem estar ativo vê a tela "Acesso pendente".

## Rodar local

```bash
cd app
npm install
cp .env.example .env.local   # preencha
npm run dev                  # http://localhost:3000
```

## Manutenção

### Devolução automática ao bot

`chat.auto_hand_back_expired()` devolve conversas cujo `bot_resume_at`
venceu. Precisa de um agendador — crie um workflow no n8n com **Schedule
Trigger** de 1 em 1 minuto chamando essa função via Postgres, ou use
`pg_cron`:

```sql
select cron.schedule('chat-devolver-bot', '* * * * *',
                     'select chat.auto_hand_back_expired()');
```

### Sincronizar templates periodicamente

O webhook `message_template_status_update` já atualiza em tempo real, mas
vale uma rede de segurança. Workflow no n8n, de hora em hora:

```
POST https://chat.dsearch.com.br/api/templates/sync
Authorization: Bearer <CHAT_SERVICE_TOKEN>
```

### PostgREST e o schema `chat`

O PostgREST só expõe schemas listados. Foi configurado **no banco**
(sobrevive a redeploy do Coolify):

```sql
alter role authenticator
  set pgrst.db_schemas = 'public,storage,graphql_public,dsearch,chat';
notify pgrst, 'reload config';
```

Se um dia a API responder `Invalid schema: chat`, é isso que se perdeu.

### Memória e swap

A VPS tem 7.8 GB. Com tudo no ar sobram ~2.8 GB, e a maior fatia é a stack do
Supabase (~1.9 GB em 14 containers), seguida de Neo4j (~800 MB) e n8n
(~170 MB). O painel em si custa ~56 MB.

Swap de 2 GB está ativo e persistido:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

`vm.swappiness = 10` fica em `/etc/sysctl.d/99-swap-chat.conf`. O padrão do
kernel é 60, que mandaria páginas quentes do Postgres para o disco sem
necessidade — o sintoma seria query lenta sem causa aparente. Aqui o swap é
rede de segurança contra OOM, não memória de trabalho.

Conferir depois de um reboot:

```bash
swapon --show && cat /proc/sys/vm/swappiness
```

### Por que Chat e dsearch dividem o mesmo Supabase

Não é economia de preguiça, é de memória: uma segunda stack custaria outros
~1.9 GB e deixaria a VPS sem folga. Um segundo *database* no mesmo Postgres
não resolveria — Auth, PostgREST e Realtime estão amarrados a um único banco,
e o painel depende dos três.

O isolamento vem dos schemas (`chat` e `dsearch`, cada um com sua RLS) e do
`is_active = false` por padrão em `chat.agents`, que impede um cadastro do
dsearch de virar agente aqui. O que continua compartilhado é `auth.users`.

Se um dia isso pesar — um segundo operador no painel, ou dados de cliente que
não devam conviver com os do dsearch — o caminho é um projeto no Supabase
Cloud só para o Chat, não uma segunda stack local. O schema `chat` é
autocontido: as migrations rodam iguais e só as chaves do `.env` mudam.

## O slot que enche o disco sozinho

O container de analytics do Supabase (Logflare) abre um slot de replicação
lógica temporário `cainophile_*` no banco `_supabase`, para uma publicação de
dez tabelas de configuração dele. Ele conecta, fica em `streaming`, responde
aos keepalives — e nunca informa posição de flush. Em `pg_stat_replication` o
`flush_lsn` desse walsender fica nulo.

Sem essa confirmação o `restart_lsn` do slot congela no instante da conexão, e
o Postgres passa a guardar todo o WAL produzido desde ali. Não é o WAL do
Logflare: é o de tudo, inclusive das mensagens do chat. Cerca de 365 MB por
dia. Em 07/09/2026 estavam retidos 1,9 GB, e o `catalog_xmin` do slot segurava
o vacuum dos catálogos 370 mil transações atrás.

O Postgres corta isso sozinho no `max_slot_wal_keep_size` (4 GB), mas só por
volta do 11º dia — e quando corta, invalida o slot e o CDC do Logflare morre
até o container reiniciar.

### O timer

`infra/manutencao/` tem o script e as units. O script derruba o walsender
quando o WAL retido passa de `LIMITE_MB` (500 por padrão): como o slot é
temporário, ele some junto, e o Logflare reconecta em segundos com um slot
novo já no LSN atual. Depois vêm dois `checkpoint`, sem os quais o WAL fica no
disco até o próximo automático.

O filtro pelo nome `cainophile%` é o que protege os slots do Realtime — eles
se chamam `supabase_realtime*` e nunca entram na consulta.

```bash
install -m 755 infra/manutencao/slot-logflare.sh /usr/local/sbin/slot-logflare.sh
install -m 644 infra/manutencao/slot-logflare.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now slot-logflare.timer
```

Roda de hora em hora, com `Persistent=true` para não pular a verificação
depois de um reboot. Para ver o que ele tem feito:

```bash
systemctl list-timers slot-logflare.timer
journalctl -u slot-logflare.service -n 20
```
