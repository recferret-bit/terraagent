#!/bin/sh
# host-gateway on Docker Desktop also installs an IPv6 address this container cannot route.
# Prisma dials that address first and does not fall back, so keep the IPv4 line only.
if [ -f /etc/hosts ]; then
  awk '!($1 ~ /:/ && /host\.docker\.internal/)' /etc/hosts > /tmp/hosts.v4 && cat /tmp/hosts.v4 > /etc/hosts || true
fi
exec "$@"
