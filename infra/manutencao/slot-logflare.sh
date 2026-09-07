#!/usr/bin/env bash
#
# O container de analytics do Supabase (Logflare) abre um slot lógico
# temporário `cainophile_*` no banco `_supabase` e nunca informa posição de
# flush. Sem essa confirmação o `restart_lsn` congela no instante da conexão e
# o Postgres passa a guardar todo o WAL desde então — cerca de 365 MB por dia.
# O próprio Postgres corta isso no `max_slot_wal_keep_size` (4 GB), mas só por
# volta do 11º dia, e o disco carrega o desperdício até lá.
#
# Como o slot é temporário, derrubar o walsender o remove junto. O Logflare
# reconecta em segundos e abre um slot novo já no LSN atual.
#
# O filtro pelo nome é o que protege os slots do Realtime: eles se chamam
# `supabase_realtime*` e nunca entram nesta consulta.

set -euo pipefail

LIMITE_MB="${LIMITE_MB:-500}"

banco="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase-db-' || true)"
if [ -z "$banco" ]; then
  echo "container do Postgres não encontrado; nada a fazer"
  exit 0
fi

psql() { docker exec -i "$banco" psql -U supabase_admin -d postgres -qtAX -c "$1"; }

alvos="$(psql "
  select r.active_pid || ' ' || pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), r.restart_lsn))
  from pg_replication_slots r
  join pg_stat_activity a on a.pid = r.active_pid
  where r.slot_name like 'cainophile%'
    and r.active
    and a.backend_type = 'walsender'
    and pg_wal_lsn_diff(pg_current_wal_lsn(), r.restart_lsn) > ${LIMITE_MB} * 1024 * 1024;
")"

if [ -z "$alvos" ]; then
  echo "slot do Logflare dentro do limite de ${LIMITE_MB} MB"
  exit 0
fi

while read -r pid atraso; do
  [ -n "$pid" ] || continue
  echo "derrubando walsender $pid, com $atraso de WAL retido"
  psql "select pg_terminate_backend($pid);" >/dev/null
done <<< "$alvos"

# Sem o checkpoint o WAL continua no disco até o próximo automático.
psql "checkpoint;" >/dev/null
psql "checkpoint;" >/dev/null
echo "WAL agora em $(psql "select pg_size_pretty(sum(size)) from pg_ls_waldir();")"
