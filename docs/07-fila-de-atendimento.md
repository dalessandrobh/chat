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

## O que falta

Numeração original da conversa que gerou esta lista, para não confundir quem
voltar depois.

**A fila virar fila**

4. Expor na view `chat.inbox` o instante em que a conversa entrou na fila, e
   mostrar "esperando há 12 min" na lista. Hoje a lista mostra tempo desde a
   última mensagem, que é outra coisa: quem espera calado afunda abaixo de
   quem acabou de escrever para o bot.
5. Abas na lista — **Aguardando** · **Minhas** · **Todas** — com Aguardando
   ordenada da mais antiga para a mais nova.
6. Contador de aguardando no menu e no `<title>` da aba.

**Ser avisado**

7. Som e destaque quando uma conversa entra na fila. O evento de Realtime já
   chega; falta usá-lo.
8. Notificação do navegador, com permissão pedida uma vez, para o painel em
   aba de fundo.

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
