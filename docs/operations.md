# Operations

This page covers the normal lifecycle: first boot, upgrade, rollback, backup,
readiness and plugin changes. The authoritative path table is in
[State and backup](data-layout.md).

## Lifecycle at a glance

| Task | Short version |
| --- | --- |
| First boot | Set `DSH_HOST` and the three forward-auth variables, then start one process |
| Upgrade | Stop the old instance, snapshot `/data` and `/workspace`, start the new pinned digest |
| State migration | Start once with `DSH_STATE_MIGRATION=apply` when the marker requires it |
| Rollback | Restore both snapshots, restore the previous edge/TLS config, run the old digest |
| Backup | Capture `/data/dsh`, `/data/home` and `/workspace` at one consistent point |
| Readiness | Run `node /opt/dsh/scripts/readiness.mjs` inside the container or Pod |

## First boot

The entrypoint requires `DSH_HOST`, a concrete container/Pod IP. The plugin
requires:

- `DSH_FORWARD_AUTH_HEADER`
- `DSH_FORWARD_AUTH_ALLOWED_SUBJECTS`
- `DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS`

Missing or invalid values make the plugin log `state=broken` and deny
application routes. The entrypoint creates the declared persistent, cache, log
and rollback roots, materializes `/data/dsh`, links DSH's cache and logs to their
dedicated roots, and starts one DSH process.

Fresh state is seeded once. The marker `/data/dsh/.distribution-state.json`
records schema, distribution and profile. Existing state from another
version/profile or an unrecognized layout is refused unless you explicitly set
`DSH_STATE_MIGRATION=apply`.

!!! danger "One writer per home"
    Do not run two DSH processes against one home, even if a shared volume claims
    support RWX. DSH has per-session file locking, not a home-wide leader or
    live session handoff.

## Upgrade and migration

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

## Recovering from profile or mount damage

The image is immutable; durable state is not. Restarting or re-pulling the same
image with the same `/data` volume does **not** reset profiles, locks or
overrides. Choose the narrowest recovery that keeps the data you need.

| Symptom | Recovery | Data impact |
| --- | --- | --- |
| `/opt/dsh` runtime, seed or `distribution.patch.yml` is shadowed by a volume | Inspect the container/Pod mounts; remove the incorrect mount and recreate. Never mount over `/opt/dsh`. | None |
| Wrong `/data` volume is mounted | Mount the correct volume; if it is empty, the image seeds fresh state. | Correct volume: none; empty volume: all durable state lost |
| Profile or `pnpm-workspace.yaml` was edited, or forward-auth was removed with `dsh plugin` | Restore `/data` and `/workspace` from a pre-change snapshot. Tavern may restore its managed manifest on restart; Web does not, so do not rely on a same-image restart. | None with snapshot; deleting `/data/dsh` loses sessions, credentials and Tavern data |
| Only the profile directory is deleted | Do not assume it re-seeds: Web unchanged state does not rebuild a missing profile. Restore the snapshot or use a fresh `/data` volume. | Snapshot: none; fresh volume: all durable state lost |
| A new image requires a state migration | Start the new digest once with `DSH_STATE_MIGRATION=apply` after stopping the old instance and snapshotting `/data` and `/workspace`. | None with snapshot; migration makes a local rollback copy under `/backups` |
| Readiness fails or all routes return 503 after plugin changes | Check the active profile for `@soulwhisper/dsh-forward-auth`; the gate fails closed when it is absent. Restore state as above. | Depends on recovery |

`/backups` is a local migration rollback copy, not an independent backup.
`docker compose down` keeps named volumes; `down -v` deletes them and forces a
fresh seed. A Kubernetes PVC behaves the same way: recreating the Pod with the
same claim preserves state; deleting or replacing the claim does not.

## Rollback

1. Stop the failed/new instance.
2. Restore the pre-upgrade `/data` and `/workspace` snapshots.
3. Restore the previous edge/proxy/TLS settings.
4. Run the previous pinned image digest.
5. Verify credentials, sessions and a workspace file in a disposable instance
   before reopening access.

The old `dsh-ui-auth` private model keys were encrypted with the old local
password. Export or re-enter them deliberately before retiring the old instance;
the forward-auth plugin has no local password and cannot decrypt them.

## Backup and restore

Back up `/data/dsh`, `/data/home` and `/workspace`; exclude `/cache`, `/logs`,
`/backups` and `/tmp`; encrypt the result; restore all three together. Use a
filesystem snapshot or stop DSH before tar/rsync. See
[State and backup](data-layout.md) for the full table and capacity guidance.

!!! warning "Backups are sensitive"
    Backups contain credentials, attachments and conversations. Never upload raw
    archives, cookies or startup reports to an issue or pull request.

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

It connects to `/tmp/dsh-forward-auth-ready.sock` and succeeds only after the
startup audit and while the mandatory gate is active. There is no anonymous HTTP
health endpoint. Readiness does not test the IdP, model provider, database, edge
or agent sandbox.

## Plugin updates

Distribution-owned DSH, forward-auth, guard patches and bundled baseline packages
change through reviewed source/lock updates and a rebuilt image. User-added Web
plugins go through the native manager and its explicit script approvals; the
market is not a privileged installer. Tavern core requires its pinned custom
workspace recipe; runtime `plugin add` of the core is not supported.

Changing an image tag does not approve a state migration, update a community
plugin or prove compatibility. Startup installs nothing.

## Source offer

The Tavern UI source link and `/distribution/source.tar.gz` must remain available
to users. See [Licensing](regulations.md) and
[Corresponding source](source-build.md).
