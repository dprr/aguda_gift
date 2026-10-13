#!/usr/bin/env bash
# Runs ON the server. Installs and runs everything inside one folder, without sudo and
# without any system change: Node and PostgreSQL are unpacked into $ROOT/runtime, the
# database lives in $ROOT/pgdata, and PostgreSQL listens on a socket in $ROOT/run with no
# network port at all.
#
#   bash $ROOT/app/deploy/server.sh deploy    # install if missing, migrate, (re)start
#   bash $ROOT/app/deploy/server.sh start | stop | status | logs
#   bash $ROOT/app/deploy/server.sh staff | load-students <file.json> | psql
#
# Nothing here survives a reboot by itself. After a reboot, run `start`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # this file is $ROOT/app/deploy/server.sh
APP="$ROOT/app"
RUNTIME="$ROOT/runtime"
PGDATA="$ROOT/pgdata"
RUN="$ROOT/run"
LOGS="$ROOT/logs"
ENV_FILE="$ROOT/.env"

NODE_MAJOR=24
PG_MAJOR=17
PGDG="https://download.postgresql.org/pub/repos/yum/$PG_MAJOR/redhat/rhel-9-x86_64"

NODE="$RUNTIME/node/bin/node"
NPM="$RUNTIME/node/bin/npm"
PGBIN="$RUNTIME/pgsql/usr/pgsql-$PG_MAJOR/bin"
export LD_LIBRARY_PATH="$RUNTIME/pgsql/usr/pgsql-$PG_MAJOR/lib"
export PATH="$RUNTIME/node/bin:$PGBIN:$PATH"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

install_node() {
  [ -x "$NODE" ] && return
  log "installing Node $NODE_MAJOR into $RUNTIME/node"
  local base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x" tmp
  tmp="$(mktemp -d)"
  curl -fsS "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  local file
  file="$(grep -oE "node-v[0-9.]+-linux-x64\.tar\.xz$" "$tmp/SHASUMS256.txt")"
  curl -fsS "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet)   # refuse a bad download
  mkdir -p "$RUNTIME/node"
  tar -xJf "$tmp/$file" -C "$RUNTIME/node" --strip-components=1
  rm -rf "$tmp"
}

install_postgres() {
  [ -x "$PGBIN/postgres" ] && return
  log "installing PostgreSQL $PG_MAJOR into $RUNTIME/pgsql (unpacked, not installed)"
  local tmp version
  tmp="$(mktemp -d)"
  # The newest version for which the server, libs, and client packages all exist.
  version="$(curl -fsS "$PGDG/" | grep -oE "postgresql$PG_MAJOR-server-$PG_MAJOR\.[0-9]+-[0-9A-Za-z.]+\.rhel9\.x86_64\.rpm" \
    | sed -E "s/^postgresql$PG_MAJOR-server-//; s/\.rhel9\.x86_64\.rpm$//" | sort -uV | tail -1)"
  mkdir -p "$RUNTIME/pgsql"
  for pkg in "postgresql$PG_MAJOR" "postgresql$PG_MAJOR-libs" "postgresql$PG_MAJOR-server"; do
    curl -fsS "$PGDG/$pkg-$version.rhel9.x86_64.rpm" -o "$tmp/$pkg.rpm"
    (cd "$RUNTIME/pgsql" && rpm2cpio "$tmp/$pkg.rpm" | cpio -idm --quiet)
  done
  rm -rf "$tmp"
  "$PGBIN/postgres" --version
}

init_db() {
  [ -f "$PGDATA/PG_VERSION" ] && return
  log "creating the database in $PGDATA"
  mkdir -p "$RUN" "$LOGS"
  chmod 700 "$RUN"   # only this user can reach the socket, so trust auth is safe
  "$PGBIN/initdb" -D "$PGDATA" -U aguda --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  # Small: the server has about 900 MB of RAM, shared with mail, XMPP, and DNS.
  cat >> "$PGDATA/postgresql.conf" <<CONF

# --- aguda ---
listen_addresses = ''                 # no TCP port at all
unix_socket_directories = '$RUN'
max_connections = 20
shared_buffers = 32MB
work_mem = 4MB
maintenance_work_mem = 32MB
CONF
  start_db
  "$PGBIN/createdb" -h "$RUN" -U aguda aguda
}

start_db() {
  "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 && return
  mkdir -p "$RUN" "$LOGS"
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOGS/postgres.log" -w start >/dev/null
  log "PostgreSQL started"
}

stop_db() {
  "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 || return 0
  "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
  log "PostgreSQL stopped"
}

app_pid() { [ -f "$RUN/app.pid" ] && kill -0 "$(cat "$RUN/app.pid")" 2>/dev/null && cat "$RUN/app.pid"; }

start_app() {
  [ -n "$(app_pid || true)" ] && return
  [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
  mkdir -p "$LOGS"
  # No subshell: $! must be Node's own PID, or `stop` kills a shell and leaves Node running.
  # stdin from /dev/null, so Node holds no file the SSH session waits on.
  nohup "$NODE" --env-file="$ENV_FILE" "$APP/src/server.ts" >> "$LOGS/app.log" 2>&1 < /dev/null &
  echo $! > "$RUN/app.pid"
  sleep 2
  [ -n "$(app_pid || true)" ] || { echo "the app did not start:"; tail -20 "$LOGS/app.log"; exit 1; }
  log "app started, pid $(cat "$RUN/app.pid")"
}

stop_app() {
  local pid; pid="$(app_pid || true)"
  [ -z "$pid" ] && return
  kill "$pid"   # SIGTERM: the server finishes a sync in progress, then exits
  for _ in $(seq 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  rm -f "$RUN/app.pid"
  log "app stopped"
}

node_run() { (cd "$APP" && "$NODE" --env-file="$ENV_FILE" "$@"); }

case "${1:-}" in
  deploy)
    install_node
    install_postgres
    init_db
    start_db
    log "installing app dependencies"
    (cd "$APP" && "$NPM" ci --omit=dev --no-fund --no-audit --loglevel=error)
    node_run src/migrate.ts
    node_run src/seed.ts
    stop_app
    start_app
    ;;
  start) start_db; start_app ;;
  stop) stop_app; stop_db ;;
  status)
    "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 && echo "PostgreSQL: running" || echo "PostgreSQL: stopped"
    pid="$(app_pid || true)"; [ -n "$pid" ] && echo "app: running, pid $pid" || echo "app: stopped"
    ;;
  logs) tail -n "${2:-50}" "$LOGS/app.log" ;;
  staff) shift; node_run src/staff.ts "$@" ;; # list, or: manager <email> | remove <email>
  load-students) shift; node_run src/university.ts "$@" ;; # <saved response.json>
  psql) shift; "$PGBIN/psql" -h "$RUN" -U aguda -d aguda "$@" ;;
  *) echo "usage: $0 deploy | start | stop | status | logs [lines] | staff [manager|remove <email>] | load-students <file.json> | psql [args]"; exit 1 ;;
esac
