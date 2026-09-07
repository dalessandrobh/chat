# A fila de atendimento

Quando o bot escala, a conversa vira `mode = human`, `status = pending` e
`assigned_agent_id = null`. Esse trio é a fila: **atendimento humano pedido,
ninguém atendendo ainda.** A RLS é por empresa, não por atendente, então todo
mundo da equipe vê a mesma fila — quem pega primeiro, atende.

Este capítulo descreve o que já existe e, no fim, o que falta. Item feito vira
descrição; item pendente fica na lista com o número original, para a conversa
não perder o fio entre uma sessão e outra.

## O que já vale

### A conversa tem um dono só

`assigned_agent_id` é permissão, não etiqueta. Os detalhes estão em
[01-arquitetura](01-arquitetura.md#a-conversa-tem-um-dono-só); em resumo:
assumir é exclusivo, tomar de alguém exige motivo e fica registrado, e quem
não é dono não responde.

### Há quanto tempo o cliente espera

`conversations.aguardando_desde` guarda o instante em que a conversa entrou na
fila. Quem carimba é o gatilho `chat.marcar_espera`, não quem escreve na
tabela: esperar é um estado derivado de outros três — humano, sem dono, não
encerrada — e derivado mantido na mão é derivado que um dia diverge. Assim
qualquer caminho deixa o carimbo certo, inclusive um `update` feito na mão no
Studio.

Continuar esperando não reinicia o relógio: uma mensagem nova do cliente não
apaga os vinte minutos que ele já esperou. Sair da fila zera o campo.

A view `chat.inbox` expõe a coluna, e a lista mostra "AGUARDANDO há 12min" na
própria etiqueta — sem o tempo, o cliente que chegou agora e o que espera há
uma hora ficam idênticos na tela.

### Abas, e o que cada uma ordena

**Aguardando** · **Minhas** · **Todas**. A lista abre em Aguardando quando há
alguém esperando; não é preferência, é a ordem do trabalho.

Aguardando ordena do mais antigo para o mais novo, ao contrário das outras: na
lista geral importa o que acabou de acontecer, na fila importa quem espera há
mais tempo. Uma busca por nome atravessa as três abas — quem procura quer
achar, não descobrir que estava na aba errada.

Conversas esperando ficam com uma barra âmbar à esquerda em qualquer aba, para
não se perderem no meio das outras.

### Ser avisado

O contador da fila fica no cabeçalho, ao lado de **Conversas**, e por isso vale
em qualquer tela: quem foi ver um template precisa saber que chegou gente. O
mesmo número entra no `<title>` da aba, que é o aviso que sobrevive ao painel
estar em segundo plano.

O sininho ao lado liga som e notificação do navegador. É opt-in por dois
motivos: o navegador não deixa tocar som sem um gesto do usuário, e a permissão
de notificação precisa ser pedida a partir de um clique. A preferência fica no
`localStorage`, por navegador — é de quem está sentado ali, não da conta.

O som é feito na hora com dois osciladores, sem arquivo: o painel não carrega
nada de fora. A notificação usa sempre a mesma `tag`, então cinco conversas em
sequência viram uma caixinha atualizada e não cinco empilhadas.

A detecção de "chegou conversa nova" compara os ids da fila com os da carga
anterior. Na primeira carga não há chegada — há o que já estava lá, e tocar por
isso seria assustar quem acabou de abrir o painel.

### Dois relógios, e o que o cliente ouve quando um vence

`devolver_ao_bot_minutos` valia para qualquer conversa em modo humano, com dono
ou sem. São duas situações que não se parecem:

| Ajuste | Quando pega | O que o cliente ouve |
|---|---|---|
| **Atendente sumiu** (`devolver_ao_bot_minutos`) | conversa **com dono**, parada | que voltou ao atendimento automático |
| **Ninguém pegou da fila** (`devolver_da_fila_minutos`) | conversa **sem dono**, esperando | que ninguém conseguiu atender, e que pode pedir de novo |
| **Encerrar por inatividade** (`encerrar_apos_minutos`) | qualquer uma, parada há mais tempo | nada — arquivar é organização interna |

A primeira quer um prazo curto: a conversa está presa numa pessoa que saiu. A
segunda quer um prazo longo, porque encurtá-lo é tirar da fila quem pediu
ajuda — com um número só, a equipe ocupada por meia hora perdia o cliente para
o bot sem ninguém ver.

O prazo da fila é de **espera**, não de silêncio: o cliente que manda três
mensagens enquanto aguarda continua aguardando. E conta a partir da abertura
mais recente da empresa, não de quando a conversa entrou na fila — a espera da
madrugada não é espera de atendimento, e sem isso a conversa que escalou às 22h
venceria no primeiro minuto do expediente, que é exatamente a conversa a quem o
aviso de fora do horário prometeu a manhã.

A frase da fila não promete retorno. Quem a escreve é o servidor, e o servidor
não sabe quando alguém vai chegar:

> Ninguém da equipe conseguiu atender até agora, desculpe a demora. Sigo por
> aqui pelo atendimento automatizado da {empresa} — me diga o que precisa. Se
> quiser falar com uma pessoa, é só pedir de novo.

Voltar ao robô calado seria pior: o cliente contaria o problema de novo, do
zero, sem saber que a primeira tentativa acabou.

Uma conversa que vai ser arquivada no mesmo passo não recebe a frase — ouvir
"ninguém conseguiu atender" e sumir da lista no mesmo segundo é ruído, não
aviso.

**Zero desliga**, e é assim que o prazo da fila nasce: ligar um relógio que
mexe em conversa de cliente sem alguém ter pedido é pior do que não ter o
relógio. Enquanto estiver em zero, quem pede um atendente espera até alguém
aparecer — ou até a conversa ser arquivada por inatividade, o que acontece
calado. A tela de Ajustes diz isso.

### Sair da conversa sem devolvê-la ao bot

São dois botões porque são duas coisas:

- **Devolver ao bot** religa a automação e despede o cliente. Serve para quando
  o atendimento humano acabou.
- **Liberar** solta a conversa de volta para a fila, calada, e o dono fica
  nulo. Serve para quem assumiu por engano, ou precisa sair no meio: o cliente
  pediu uma pessoa e continua querendo uma, e anunciar um rodízio interno seria
  ruído, não aviso.

Liberar exige que a conversa esteja em atendimento humano — uma que está com o
bot não está em fila nenhuma, e mandá-la para lá seria escalar, que é outra
ação com outro aviso ao cliente. Soltar a conversa de outro atendente segue a
mesma regra do resto: recusa com `PT409`, e só passa com motivo, que fica no
`handoff_events` junto com de quem era.

O relógio da fila recomeça do zero ao liberar. A espera anterior acabou no
momento em que alguém assumiu; o que começa agora é uma espera nova.

Por causa disso, a apresentação ao cliente deixou de olhar para o dono anterior
e passou a olhar para a conversa: se já existe mensagem de atendente nela, quem
assume diz que vai **continuar** o atendimento. Uma conversa liberada fica sem
dono sem ter voltado ao começo, e dizer "agora você está sendo atendido por um
ser humano" a quem já estava com um soaria como se tudo tivesse recomeçado.

### Encerrar

Arquivar tira a conversa da lista de trabalho. Não fala com o cliente, e a
conversa reabre sozinha se ele voltar a escrever — por isso o botão não pede
posse: quem organiza a lista não está tomando o atendimento de ninguém.

## O que falta

Numeração original da conversa que gerou esta lista, para não confundir quem
voltar depois.

**Direcionar a um atendente**

9. Ação "Atribuir a…" na barra de handoff, com a lista de agentes ativos.
   Grava quem atribuiu, além de quem recebeu. Tem uma armadilha: atribuir
   define o dono, e definir o dono tira a conversa da fila e zera o
   `aguardando_desde`. Atribuir a quem está almoçando sumiria com o cliente da
   fila, do contador e do relógio — em silêncio. Por isso anda junto com o 10,
   ou precisa de um estado "atribuída, ainda não aceita" com relógio próprio.
10. Presence do Realtime marcando quem está com o painel aberto, para não
    atribuir conversa a quem não está.

**Prazos e higiene**

14. `unread_count` por atendente. Um agente abrir zera o contador para todos.

