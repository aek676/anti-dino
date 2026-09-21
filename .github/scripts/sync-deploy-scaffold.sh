#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_SSH_HOST:?DEPLOY_SSH_HOST is required}"
: "${DEPLOY_SSH_USER:?DEPLOY_SSH_USER is required}"

DEST="${DEPLOY_PATH:-/opt/apps/anti-dino}"

[ -s deploy/varlock-env.json ] || { echo "sync: deploy/varlock-env.json is missing, resolve the env first" >&2; exit 1; }
chmod 600 deploy/varlock-env.json

echo "Syncing scaffold to $DEPLOY_SSH_USER@$DEPLOY_SSH_HOST:$DEST"

# include dotfiles like .env.example
shopt -s dotglob
scp -o BatchMode=yes deploy/* "$DEPLOY_SSH_USER@$DEPLOY_SSH_HOST:$DEST/"
