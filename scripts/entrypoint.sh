#!/bin/sh
set -eu
umask 077

: "${DSH_HOST:?Set DSH_HOST to the container or Pod concrete local IP}"
# Forward-auth configuration is validated by the plugin so a broken header,
# subject or CIDR configuration produces a fixed status=broken log before the
# Host denies every route.
: "${DSH_HOME:=/data/dsh}"
: "${HOME:=/data/home}"
: "${DSH_AGENTS_HOME:=$HOME/.agents}"
: "${DSH_BACKUP_ROOT:=/backups}"
: "${XDG_CACHE_HOME:=/cache}"
: "${DSH_PROFILE:=web}"
export DSH_HOME HOME DSH_AGENTS_HOME DSH_BACKUP_ROOT XDG_CACHE_HOME
node --input-type=module -e 'import { isIP } from "node:net"; const host = process.env.DSH_HOST; if (!isIP(host) || host === "0.0.0.0" || host === "::") throw new Error("DSH_HOST must be a concrete local IP, never a wildcard");'
if [ -n "${DSH_TLS_CERT:-}" ] || [ -n "${DSH_TLS_KEY:-}" ]; then
  : "${DSH_TLS_CERT:?DSH_TLS_CERT and DSH_TLS_KEY must be supplied together}"
  : "${DSH_TLS_KEY:?DSH_TLS_CERT and DSH_TLS_KEY must be supplied together}"
fi
mkdir -p "$HOME" "$DSH_AGENTS_HOME" "$XDG_CACHE_HOME" "$DSH_HOME" /logs "$DSH_BACKUP_ROOT" /workspace
node /opt/dsh/scripts/materialize-state.mjs
node /opt/dsh/scripts/seed-tavern-plugins.mjs

# The previous image used /data/cache as XDG_CACHE_HOME. Move that legacy root
# out of state once; it is rebuildable and must not remain in /data backups.
if [ -e /data/cache ] && [ /data/cache != "$XDG_CACHE_HOME" ]; then
  mv /data/cache "/cache/legacy-xdg-cache-$(date +%s)-$$"
fi

# DSH hard-codes cache and startup logs under DSH_HOME. Keep those paths as
# symlinks so immutable state stays in /data while rebuildable cache and
# non-authoritative logs live on their own volumes. Existing directories are
# moved under the target once, not merged into the new cache.
link_volume() {
  source_path=$1
  target_path=$2
  label=$3
  mkdir -p "$target_path"
  if [ -L "$source_path" ]; then
    rm -f "$source_path"
  elif [ -e "$source_path" ]; then
    mv "$source_path" "$target_path/legacy-$label-$(date +%s)-$$"
  fi
  ln -s "$target_path" "$source_path"
}
link_volume "$DSH_HOME/cache" /cache/dsh cache
link_volume "$DSH_HOME/logs" /logs logs

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
