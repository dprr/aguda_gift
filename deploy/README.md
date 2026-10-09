# Deployment

## Deploy a new version

```bash
deploy/push.sh felber.eu.org
```

Only committed files are sent. The script installs anything missing, applies the
migrations, and restarts the app. A second deploy takes about 20 seconds.

## On the server

Everything lives in one folder, and nothing in it needs `sudo`:

```
/home/opc/aguda/
  .env          # mode 600. Server settings and secrets. Never in git
  app/          # the code, replaced on every deploy
  runtime/      # Node 24 and PostgreSQL 17, unpacked, not installed
  pgdata/       # the database
  run/          # PostgreSQL's socket and the app's PID file. No TCP port
  logs/         # app.log and postgres.log
```

```bash
bash /home/opc/aguda/app/deploy/server.sh status
bash /home/opc/aguda/app/deploy/server.sh logs 100
bash /home/opc/aguda/app/deploy/server.sh stop
bash /home/opc/aguda/app/deploy/server.sh start
```

⚠️ **Nothing starts after a reboot.** There is no system service, by the owner's choice.
After every reboot of the server, run `start`.

## The demo at aguda.felber.eu.org

`.env` sets `DEMO=1`, `DEV_LOGIN=1`, and `SYNC_SOURCE=fake`. Every page shows a red banner,
the data is invented, and anyone can log in as anyone. **Never put real data on it.**

Google login there uses its **own** OAuth client, `838804867749-8ih1…`, whose authorized
redirect URI is `https://aguda.felber.eu.org/auth/callback`. The laptop's `.env` uses a
different client, `115180069784-ibfi…`, for `http://localhost:3000`. Test users must be
added to each client's project separately.

## The two changes outside the folder

Made on 2026-10-09, each with the owner's approval.

| What | Where | Undo |
|---|---|---|
| DNS record `aguda CNAME www`, serial `1000000006` → `1000000007` | `/var/named/felber.eu.org`. Backup: `felber.eu.org.bak.20261009132820` | Remove the line, raise the serial, `named-checkzone`, `rndc reload felber.eu.org` |
| Caddy site, proxy to `127.0.0.1:3000` | `/etc/caddy/Caddyfile.d/aguda.caddyfile` | Rename to `aguda.caddyfile.disabled`, then `systemctl reload caddy` |

To take the demo offline without removing anything: disable the Caddy file as above, then
run `server.sh stop`.
