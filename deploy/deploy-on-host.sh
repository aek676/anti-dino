#!/usr/bin/env sh
set -eu

tag="${SSH_ORIGINAL_COMMAND:-}"
case "$tag" in
	sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
	*)
		echo "deploy: expected a sha-xxxxxxx image tag, got '$tag'" >&2
		exit 1
		;;
esac

cd "$(dirname "$0")"
[ -f compose.yaml ] || { echo "deploy: no compose.yaml next to $0" >&2; exit 1; }
[ -s varlock-env.json ] || { echo "deploy: no varlock-env.json next to $0, CI uploads it before deploying" >&2; exit 1; }

chmod 600 varlock-env.json

IMAGE_TAG="$tag"
__VARLOCK_ENV="$(cat varlock-env.json)"
export IMAGE_TAG __VARLOCK_ENV

docker compose pull app
docker compose up -d app
docker image prune -f
