# State and backup

The state split follows **backup authority**, not convenience. Durable state
lives on `/data` and `/workspace`; rebuildable cache, diagnostic logs, local
rollback copies and scratch have dedicated roots.

## Backup in one glance

**Back up together:** `/data/dsh`, `/data/home`, `/data/memory`, `/workspace`.

**Never include:** `/cache`, `/logs`, `/backups`, `/tmp`.

Use a filesystem snapshot or stop DSH before tar/rsync. The four roots must be
captured at one consistent point. Encrypt the archive and restrict access.

## Layout

| Path | Class | Contents | Independent backup | Loss acceptable |
| --- | --- | --- | --- | --- |
| `/data/dsh` | Durable state | Profiles, sessions, storages, attachments, `.credentials.yaml`, anonymous ID, Tavern `profile-data`, distribution marker | **Required, encrypted** | No |
| `/data/home` | Durable state/config | `HOME`, XDG config/data, pnpm home, shell/tool config | Required | No |
| `/data/memory` | Durable user memory | Mnemon spaces, `MEMORY.md`, memory indexes and skills | **Required, encrypted** | No |
| `/workspace` | Durable user data | User projects, generated files, shell cwd content | **Required, consistent with `/data/dsh`** | No |
| `/cache` | Rebuildable cache | `XDG_CACHE_HOME`, npm cache, DSH cache via `$DSH_HOME/cache` symlink | No | Yes; emptyDir or separate cache volume |
| `/logs` | Diagnostics | DSH startup reports via `$DSH_HOME/logs` symlink | No | Yes if retention is handled elsewhere; content is sensitive |
| `/backups` | Local rollback copy | Migration snapshots made before adopting a new distribution | **No:** not an independent backup | Yes, if migrations are supervised; external snapshots are mandatory |
| `/tmp` | Scratch | Readiness socket, shell activity, ephemeral files | No | Yes, tmpfs |
| `/opt/dsh`, `/opt/apps/dsh-tavern` | Immutable image | Runtime, seed, source, archive | No | Read-only; replaced by image |

## DSH subtrees

- `$DSH_HOME/sessions` — durable JSONL session logs. These are state, not cache,
  despite being append-only diagnostics-like files. Back them up.
- `$DSH_HOME/storages` — durable JSON storage, including workspace/session
  metadata. Back it up.
- `$DSH_HOME/attachments/v1` — persistent content-addressed attachments. Back
  it up; attachments may contain personal data.
- `$DSH_HOME/skills` — user-owned skill recommendations and edits. Bundled
  recommendations are seeded once; deleted skills are not restored on restart.
- `$DSH_HOME/cache` — DSH's hard-coded cache path. The entrypoint makes it a
  symlink to `/cache/dsh`, so it is not part of a state backup.
- `$DSH_HOME/logs` — DSH's hard-coded startup report path. The entrypoint makes
  it a symlink to `/logs`, so it is not part of a state backup.
- `$DSH_HOME/migrations` is **not** used. The configurable rollback root is
  `DSH_BACKUP_ROOT` (default `/backups` in the image).
- `$DSH_HOME/.credentials.yaml` — secrets. Back up encrypted and keep mode 0600.
- Tavern data is under `/data/dsh/profile-data/tavern/data`; back it up.

The legacy `/data/dsh-migrations` path is retained only as the default fallback
for non-image callers/tests. In the image, `DSH_BACKUP_ROOT=/backups` is
explicit, and `scripts/materialize-state.mjs` rejects a backup root inside
`DSH_HOME`.

## Memory

The bundled `dsh-mnemon` profile defaults to `storageScope: custom` with
`dataDir: /data/memory/mnemon`. A profile overlay replaces the whole Mnemon
configuration, so keep `dataDir` under `/data` if you override it; otherwise
memory can fall outside the backup. Memory is durable user data inside `/data`,
not plugin code. Back it up with
`/data/dsh` and `/workspace` at the same point. `remoteAccess: trusted-host`
is set in the Web profile so a trusted-edge session can manage memory; it does
not replace forward-auth.

Do not place `/data/memory` on an `emptyDir`, and do not treat the profile
package directory as memory storage. Plugin upgrades may replace code and
package state; the memory directory is the stable boundary.

## Workspace and HOME

`/data/home` is HOME: XDG configuration, pnpm, shell state and agent skill
data. It is not the project workspace. `/workspace` is the durable user-data
root and the DSH sandbox `workspace-write` root. Register `/workspace` with
**Add workspace** in the UI; do not register `/data/home` as a workspace.
Using HOME as the agent workspace puts command working directories outside the
sandbox root and mixes project files with credentials and configuration.

### Skill roots

The skill provider scans native roots automatically when the preset provider is
mounted:

| Root | Discovery |
| --- | --- |
| `<workspace>/.dsh/skills` | project-local skills |
| `<workspace>/.agents/skills` | project-local agent skills |
| `$DSH_HOME/skills` | user skills, including the bundled recommendations |
| `$DSH_AGENTS_HOME/skills` | shared agent skills |

The example StatefulSet does not mount anything below `/data/home`; in that
layout `$DSH_AGENTS_HOME/skills` is a normal directory on the durable `/data`
PVC. If a deployment adds a nested emptyDir or ConfigMap below HOME to create a
skill root, the runtime creates the parent directories as `root:<fsGroup> 2755`
before the app starts; the uid 1000 app cannot repair that from
`entrypoint.sh`. A new PVC does not avoid this: the runtime-created parent is
independent of the PVC age. Use `DSH_SKILL_DIRS` for extra roots outside HOME.

`DSH_SKILL_DIRS` is an optional distribution env for **additional** roots. It
is not set by default and does not replace the native roots. Set it to a
comma-separated list only when a deployment needs extra roots, for example:

```text
DSH_SKILL_DIRS=/skills
```

`/skills` can be a read-only ConfigMap. For a live workspace root, use
`/workspace/.agent/skills` or the native `/workspace/.dsh/skills`; `.agent` is
a distribution convention, not a native DSH name. The extra provider is
enabled only while `DSH_SKILL_DIRS` is non-empty; with the variable unset, the
native roots continue to work and no extra path is assumed.

The bundled recommendations remain under `$DSH_HOME/skills`. Do not move or
duplicate them into `DSH_SKILL_DIRS`; the native root already exposes them, and
moving them would change their seed and backup lifecycle.

The app entrypoint creates HOME on first start. No init container or root
chown is part of this layout; do not mount a volume below HOME just to create a
skill root.

## Why this split

- Cache and logs can grow without warning. Keeping them in `/data` makes backup
  size, restore time and capacity planning unpredictable.
- Logs can contain prompts, configuration fragments or credentials. They are not
  part of recovery state and should have separate retention/access.
- Migration rollback copies contain credentials. They must not silently become
  part of the primary backup or be mistaken for an independent backup.
- `/workspace` is user data with a different size and snapshot cadence. It stays
  on its own volume, but backup consistency with `/data/dsh` still matters.
- `/data/dsh` and `/data/home` share one PVC to keep a single-owner snapshot
  simple. They can be split into separate PVCs later, but then backups must be
  coordinated and restored together.

## Startup migration

On startup the entrypoint materializes state first, then:

1. moves a legacy `/data/cache` root once to
   `/cache/legacy-xdg-cache-<timestamp>-<pid>`;
2. creates `/cache/dsh`, moves an old real `$DSH_HOME/cache` once to
   `/cache/dsh/legacy-cache-<timestamp>-<pid>`, and symlinks the state path;
3. creates `/logs`, moves an old real `$DSH_HOME/logs` once to
   `/logs/legacy-logs-<timestamp>-<pid>`, and symlinks the state path;
4. leaves `/tmp` untouched (it is kernel/tmpfs scratch).

Deleting a legacy cache copy is safe after inspection. Legacy logs are retained
only for diagnosis; apply the same sensitivity policy as current logs. A legacy
`/data/dsh-migrations` directory is not moved automatically; exclude it from
state backups and remove it only after validating the current rollback policy.

## Restore and verify

Restore pre-upgrade `/data` and `/workspace` into separate target volumes,
restore the previous proxy/TLS configuration, and start the previous pinned
digest. Do not attach an old image to already migrated data. Do not run two
writers against one home.

Mount the restored volumes into a disposable instance and confirm profiles,
credentials, sessions and a workspace file before cutover. A successful container
start is not proof of state correctness.

## Capacity guidance

Size `/data` for profiles, user plugins, sessions, attachments and Tavern data.
Size `/workspace` independently for project data. Size `/cache` for package and
attachment caches, `/logs` for the desired retention, and `/backups` for one
migration copy plus headroom. Cache and logs are disposable; do not let them
consume the `/data` claim.
