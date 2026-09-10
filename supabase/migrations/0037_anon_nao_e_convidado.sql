-- `anon` não é convidado.
--
-- Função no Postgres nasce com EXECUTE para PUBLIC. As migrations anteriores
-- concederam a `authenticated` e a `service_role` o que cada um precisa, mas
-- conceder não tira de PUBLIC — e em PUBLIC está `anon`, o papel da chave
-- anônima, que viaja no bundle de todo navegador que abre o painel.
--
-- Trinta e seis funções do schema estavam alcançáveis assim. A tranca que
-- sobrava era o uuid do argumento, e uuid não é tranca: é identificador. Pior,
-- três delas nem argumento pedem — `claim_next_send`, `claim_due_bot_turns` e
-- `auto_hand_back_expired` — e mexem na fila de envio e no modo das conversas.
--
-- `assert_same_company` não segura nada disso: ela deixa passar quando não há
-- usuário logado, porque é assim que o servidor a atravessa. Sem uid, `anon` e
-- o servidor são indistinguíveis para ela. Quem separa os dois é o papel, e
-- papel se separa aqui.
--
-- Não dá para tirar de um papel só: privilégio dado a PUBLIC vale para todos e
-- não se revoga de um. Então é revogar de PUBLIC e devolver, nome por nome, a
-- quem chama de verdade. A lista abaixo saiu de quem chama no código:
-- `supabase/server` e o navegador são `authenticated`; `supabase/admin` é
-- `service_role`.

begin;

-- -----------------------------------------------------------------------------
-- O painel chama, com a sessão de quem está logado
-- -----------------------------------------------------------------------------

revoke all on function chat.render_knowledge(uuid)                             from public;
revoke all on function chat.render_company_profile(uuid)                       from public;
revoke all on function chat.horario_de_atendimento(uuid, timestamptz)          from public;
revoke all on function chat.horario_em_texto(jsonb)                            from public;
revoke all on function chat.horario_semana_valido(jsonb)                       from public;
revoke all on function chat.close_conversation(uuid)                           from public;
revoke all on function chat.reopen_conversation(uuid)                          from public;
revoke all on function chat.mark_read(uuid)                                    from public;
revoke all on function chat.enqueue_campaign(uuid, text[])                     from public;
revoke all on function chat.create_company(text)                               from public;
revoke all on function chat.channel_secret_names(uuid)                         from public;
revoke all on function chat.set_channel_secret(uuid, text, text)               from public;
revoke all on function chat.clear_channel_secret(uuid, text)                   from public;

grant execute on function chat.render_knowledge(uuid)                    to authenticated, service_role;
grant execute on function chat.render_company_profile(uuid)              to authenticated, service_role;
grant execute on function chat.horario_de_atendimento(uuid, timestamptz) to authenticated, service_role;
grant execute on function chat.horario_em_texto(jsonb)                   to authenticated, service_role;
grant execute on function chat.horario_semana_valido(jsonb)              to authenticated, service_role;
grant execute on function chat.close_conversation(uuid)                  to authenticated, service_role;
grant execute on function chat.reopen_conversation(uuid)                 to authenticated, service_role;
grant execute on function chat.mark_read(uuid)                           to authenticated, service_role;
grant execute on function chat.enqueue_campaign(uuid, text[])            to authenticated, service_role;
grant execute on function chat.create_company(text)                      to authenticated;
grant execute on function chat.channel_secret_names(uuid)                to authenticated, service_role;
grant execute on function chat.set_channel_secret(uuid, text, text)      to authenticated, service_role;
grant execute on function chat.clear_channel_secret(uuid, text)          to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Só o servidor chama
-- -----------------------------------------------------------------------------
-- Fila de envio, turno do bot, webhook e relógios. Nada disso tem caminho pela
-- tela, e as três primeiras não pedem argumento nenhum: eram a porta aberta
-- que não dependia de adivinhar uuid.

revoke all on function chat.claim_next_send()                                  from public;
revoke all on function chat.claim_due_bot_turns(integer)                       from public;
revoke all on function chat.auto_hand_back_expired()                           from public;
revoke all on function chat.enqueue_bot_turn(uuid, jsonb, interval, interval)  from public;
revoke all on function chat.resolve_conversation(uuid, text, text)             from public;
revoke all on function chat.opt_out(uuid, text, chat.unsendable_reason)        from public;
revoke all on function chat.seed_qualification(uuid)                           from public;

grant execute on function chat.claim_next_send()                                 to service_role;
grant execute on function chat.claim_due_bot_turns(integer)                      to service_role;
grant execute on function chat.auto_hand_back_expired()                          to service_role;
grant execute on function chat.enqueue_bot_turn(uuid, jsonb, interval, interval) to service_role;
grant execute on function chat.resolve_conversation(uuid, text, text)            to service_role;
grant execute on function chat.opt_out(uuid, text, chat.unsendable_reason)       to service_role;
grant execute on function chat.seed_qualification(uuid)                          to service_role;

-- -----------------------------------------------------------------------------
-- Peças internas: ninguém chama de fora
-- -----------------------------------------------------------------------------
-- Perguntas sobre quem está logado e funções de gatilho. `assert_same_company`
-- é a que mais importa aqui: exposta, ela é um oráculo que diz se um uuid é
-- uma empresa existente.

revoke all on function chat.assert_same_company(uuid)  from public;
revoke all on function chat.current_company()          from public;
revoke all on function chat.is_active_agent()          from public;
revoke all on function chat.is_admin()                 from public;
revoke all on function chat.is_manager()               from public;
revoke all on function chat.is_platform_owner()        from public;
revoke all on function chat.is_within_window(uuid)     from public;
revoke all on function chat.chave_de_numero(text)      from public;

-- Continuam valendo para quem já as usava: as políticas de RLS as chamam em
-- nome de quem está logado, e o servidor as chama direto.
grant execute on function chat.assert_same_company(uuid)  to authenticated, service_role;
grant execute on function chat.current_company()          to authenticated, service_role;
grant execute on function chat.is_active_agent()          to authenticated, service_role;
grant execute on function chat.is_admin()                 to authenticated, service_role;
grant execute on function chat.is_manager()               to authenticated, service_role;
grant execute on function chat.is_platform_owner()        to authenticated, service_role;
grant execute on function chat.is_within_window(uuid)     to authenticated, service_role;
grant execute on function chat.chave_de_numero(text)      to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- O que fica de fora desta migration, e por quê
-- -----------------------------------------------------------------------------
-- Sobram oito funções alcançáveis por PUBLIC, e todas devolvem `trigger`:
-- `touch_updated_at`, `marcar_espera`, `handle_new_user` e as outras cinco. O
-- PostgREST não expõe função que devolve trigger, e o Postgres recusa chamá-la
-- fora de um gatilho. Revogá-las seria ruído numa lista que precisa ser lida.

commit;

notify pgrst, 'reload schema';
