#!/usr/bin/env bash
# Runs on the LAPTOP. Sends the committed code to the server and deploys it.
#
#   deploy/push.sh felber.eu.org            # root defaults to /home/opc/aguda
#   deploy/push.sh host /some/other/root
#
# Only committed files are sent, through `git archive`. So .env, secret.txt, and anything
# uncommitted can never reach the server by accident.
set -euo pipefail

HOST="${1:?usage: deploy/push.sh HOST [ROOT]}"
ROOT="${2:-/home/opc/aguda}"

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: uncommitted changes are NOT deployed. Deploying $(git rev-parse --short HEAD)."
fi

echo "sending $(git rev-parse --short HEAD) to $HOST:$ROOT/app"
# Replace the app folder entirely, so a file deleted from git is deleted on the server too.
git archive --format=tar HEAD |
  ssh -o BatchMode=yes "$HOST" "bash -c 'rm -rf $ROOT/app.new && mkdir -p $ROOT/app.new && tar -x -C $ROOT/app.new && rm -rf $ROOT/app.old && { [ -d $ROOT/app ] && mv $ROOT/app $ROOT/app.old || true; } && mv $ROOT/app.new $ROOT/app'"

ssh -o BatchMode=yes "$HOST" "bash $ROOT/app/deploy/server.sh deploy"
