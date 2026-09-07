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

## O que falta

Numeração original da conversa que gerou esta lista, para não confundir quem
voltar depois.

**Direcionar a um atendente**

9. Ação "Atribuir a…" na barra de handoff, com a lista de agentes ativos.
   Grava quem atribuiu, além de quem recebeu.
10. Presence do Realtime marcando quem está com o painel aberto, para não
    atribuir conversa a quem está almoçando.
11. "Liberar para a fila": tira o dono, mantém `pending`, não avisa o cliente.
    Hoje só existe "Devolver ao bot", que é outra coisa.

**Prazos e higiene**

12. Separar o relógio de "o atendente sumiu" do de "ninguém pegou". Hoje os
    dois usam `devolver_ao_bot_minutos`, então a equipe ocupada por meia hora
    perde o cliente para o bot sem ninguém ver.
13. Decidir o que o cliente ouve quando o prazo da fila vence. Hoje, silêncio.
14. `unread_count` por atendente. Um agente abrir zera o contador para todos.
15. `HandoffBar` tem `encerrarOuReabrir()` completa, ligada a `/close`, que
    nunca foi renderizada — o botão Encerrar não existe na tela.
