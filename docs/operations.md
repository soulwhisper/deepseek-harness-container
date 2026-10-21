# Operations

## First boot

The entrypoint requires `DSH_HOST` (a concrete container/Pod IP),
`DSH_SSO_ALLOWED_UIDS` and `DSH_SSO_TRUSTED_PROXY_CIDRS`. It creates the
declared persistent/cache/log/rollback roots, materializes `/data/dsh`, links
DSH's cache and logs to their dedicated roots, and starts one DSH process.

Fresh state is seeded once. The marker `/data/dsh/.distribution-state.json`
records schema, distribution and profile. Existing state from another
version/profile or an unrecognized layout is refused unless you explicitly set
`DSH_STATE_MIGRATION=apply`.

Do not run two DSH processes against one home, even if a shared volume claims to
support RWX. DSH has per-session file locking, not a home-wide leader or live
session handoff. See [HA plan](ha-plan.md).

## Migration

Before migrating:

1. Stop the old instance. Keep the old image digest and edge/TLS configuration.
2. Snapshot/export `/data` and `/workspace` together; encrypt the result. The
   cache/log/rollback roots are not part of this snapshot.
3. For the old `/home/node/.dsh` layout, mount the old backup read-only or set
   `DSH_LEGACY_HOME`; mount the new writable `/data` separately. Migration copies
   the legacy home and never deletes the source.
4. Start the new pinned image with `DSH_STATE_MIGRATION=apply` exactly once.
5. Check `/data/dsh/.distribution-state.json`, the readiness command and a real
   authenticated request.

The migration creates a local rollback copy under `DSH_BACKUP_ROOT`
(`/backups/<timestamp>` in the image) and excludes `$DSH_HOME/cache` and
`$DSH_HOME/logs`. That copy is **not** an independent backup or atomic snapshot.
It is a convenience for immediate rollback while the migration is supervised.

If migration fails, do not start DSH or retry blindly. Restore the pre-upgrade
`/data` and `/workspace` snapshots into separate volumes. Do not attach the old
image to already migrated data.

## Rollback

1. Stop the failed/new instance.
2. Restore the pre-upgrade `/data` and `/workspace` snapshots.
3. Restore the previous edge/proxy/TLS settings.
4. Run the previous pinned image digest.
5. Verify credentials, sessions and a workspace file in a disposable instance
   before reopening access.

The old `dsh-ui-auth` private model keys were encrypted with the old local
password. Export or re-enter them deliberately before retiring the old instance;
SSO cannot decrypt them.

## Backup and restore

See [data layout](data-layout.md) for the authoritative path/backup table.
Short version: back up `/data/dsh`, `/data/home` and `/workspace`; exclude
`/cache`, `/logs`, `/backups` and `/tmp`; encrypt; restore all three together.

Backups contain credentials, attachments and conversations. Never upload raw
archives, cookies or startup reports to an issue or PR.

## Logs and cache

DSH's hard-coded `$DSH_HOME/logs` and `$DSH_HOME/cache` are symlinks to `/logs`
and `/cache/dsh`. Logs are sensitive and non-authoritative; the cache is
rebuildable. The entrypoint moves an old real directory once under a
`legacy-*` name rather than merging cache contents. Inspect and delete legacy
cache after confirming the new instance boots; retain logs only under your
sensitive-data policy.

`/logs` and `/backups` are separate from `/data` so a full `/data` snapshot does
not silently include diagnostics or rollback credentials. A Pod using emptyDir
for either root loses them on restart; that is acceptable for cache/backup
scratch but not for logs you need to retain.

## Readiness and health

Readiness is local-only:

```bash
node /opt/dsh/scripts/readiness.mjs
```

It succeeds only after the startup audit and while the mandatory gate is
active. There is no anonymous HTTP health endpoint. Readiness does not test the
IdP, model provider, database, edge or agent sandbox.

## Plugin updates

Distribution-owned DSH, SSO, guard patches and bundled baseline packages change
through reviewed source/lock updates and a rebuilt image. User-added Web
plugins go through the native manager and its explicit script approvals; the
market is not a privileged installer. Tavern core requires its pinned custom
workspace recipe; runtime `plugin add` of the core is not supported.

Changing an image tag does not approve a state migration, update a community
plugin or prove compatibility. Startup installs nothing.

## Source offer

The Tavern UI source link and `/distribution/source.tar.gz` must remain
available to users. See [regulations](regulations.md) and
[source build](source-build.md).
