#!/usr/bin/env sh
set -eu

: "${DEPLOY_SSH_HOST:?expected the VM running the app}"
: "${DEPLOY_SSH_USER:?expected the SSH user on that VM}"

tag="sha-$(printf '%.7s' "$(git rev-parse HEAD)")"

exec ssh -o BatchMode=yes "$DEPLOY_SSH_USER@$DEPLOY_SSH_HOST" "$tag"
