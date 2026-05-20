#!/bin/sh
# Selects which Worklenz nginx config is active inside the container, based on
# the NGINX_MODE env var.
#
#   NGINX_MODE=ssl        -> nginx/conf.d/worklenz.conf            (default, terminates TLS itself)
#   NGINX_MODE=http-only  -> nginx/conf.d-http-only/worklenz.conf  (plain HTTP, behind external TLS proxy)
#
# Both candidates are bind-mounted read-only at /etc/nginx/conf.d-templates/<mode>/
# by docker-compose. This script copies the chosen one into the container's
# (writable) /etc/nginx/conf.d/worklenz.conf and removes the upstream image's
# default.conf so it doesn't conflict.

set -eu

MODE="${NGINX_MODE:-ssl}"
SRC="/etc/nginx/conf.d-templates/${MODE}/worklenz.conf"
DEST="/etc/nginx/conf.d/worklenz.conf"

if [ ! -f "$SRC" ]; then
    echo "select-mode: ERROR — no template at $SRC for NGINX_MODE='$MODE'" >&2
    echo "select-mode: expected one of: ssl, http-only" >&2
    exit 1
fi

rm -f /etc/nginx/conf.d/default.conf
cp "$SRC" "$DEST"
echo "select-mode: NGINX_MODE=$MODE — using $SRC"
