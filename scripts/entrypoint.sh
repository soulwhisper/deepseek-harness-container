#!/bin/sh
set -eu
umask 077

: "${DSH_HOST:?Set DSH_HOST to the container or Pod concrete local IP}"
: "${DSH_SSO_ALLOWED_UIDS:?Set the comma-separated stable Authentik UID allowlist}"
: "${DSH_SSO_TRUSTED_PROXY_CIDRS:?Set explicit trusted proxy peer CIDRs}"
: "${DSH_HOME:=/data/dsh}"
: "${HOME:=/data/home}"
: "${XDG_CACHE_HOME:=/data/cache}"
: "${DSH_PROFILE:=web}"
export DSH_HOME HOME XDG_CACHE_HOME
node --input-type=module -e 'import { isIP } from "node:net"; const host = process.env.DSH_HOST; if (!isIP(host) || host === "0.0.0.0" || host === "::") throw new Error("DSH_HOST must be a concrete local IP, never a wildcard");'
if [ -n "${DSH_TLS_CERT:-}" ] || [ -n "${DSH_TLS_KEY:-}" ]; then
  : "${DSH_TLS_CERT:?DSH_TLS_CERT and DSH_TLS_KEY must be supplied together}"
  : "${DSH_TLS_KEY:?DSH_TLS_CERT and DSH_TLS_KEY must be supplied together}"
fi
mkdir -p "$HOME" "$XDG_CACHE_HOME" "$DSH_HOME" /workspace
node /opt/dsh/scripts/materialize-state.mjs

set -- dsh --profile "$DSH_PROFILE" --patch /opt/dsh/profiles/distribution.patch.yml --host "$DSH_HOST" --port "${DSH_PORT:-3080}" --no-open
if [ -n "${DSH_PUBLIC_URL:-}" ]; then
  set -- "$@" --public-url "$DSH_PUBLIC_URL"
fi
# Split only the documented authority list, never an assembled command string.
old_ifs=$IFS
IFS=', 
'
for host in ${DSH_TRUSTED_HOSTS:-}; do
  [ -z "$host" ] || set -- "$@" --trusted-host "$host"
done
IFS=$old_ifs
if [ -n "${DSH_TLS_CERT:-}" ]; then
  set -- "$@" --tls-cert "$DSH_TLS_CERT" --tls-key "$DSH_TLS_KEY"
fi
cd /workspace
exec "$@"
