#!/bin/sh
set -eu
cmd="${SSH_ORIGINAL_COMMAND:-}"
case "$cmd" in
	sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
		exec /opt/apps/anti-dino/deploy-on-host.sh
		;;
	/usr/lib/openssh/sftp-server | /usr/libexec/openssh/sftp-server)
		exec "$cmd"
		;;
esac
echo "ssh-wrapper: rejected command '$cmd'" >&2
exit 1
