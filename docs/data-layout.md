# Data layout and backup policy

The state split is by **backup authority**, not by convenience. Durable state
lives on `/data` and `/workspace`; rebuildable cache, diagnostic logs, local
rollback copies and scratch have dedicated roots.

## Canonical table

| Path | Class | Contents | Independent backup | tmpfs / loss acceptable |
| --- | --- | --- | --- | --- |
| `/data/dsh` | Durable state | Profiles, sessions, storages, attachments, `.credentials.yaml`, anonymous ID, Tavern `profile-data`, distribution marker | **Required, encrypted** | No |
| `/data/home` | Durable state/config | `HOME`, XDG config/data, pnpm home, shell/tool config | Required | No |
| `/workspace` | Durable user data | User projects, generated files, shell cwd content | **Required, consistent with `/data/dsh`** | No |
| `/cache` | Rebuildable cache | `XDG_CACHE_HOME`, npm cache, DSH cache via `$DSH_HOME/cache` symlink | No | Yes, preferably emptyDir/separate cache volume |
| `/logs` | Diagnostics | DSH startup reports via `$DSH_HOME/logs` symlink | No | Yes if log retention is handled elsewhere; content is sensitive |
| `/backups` | Local rollback copy | Migration snapshots made before adopting a new distribution | **No:** not an independent backup | Yes, if migrations are supervised; external snapshots are mandatory |
| `/tmp` | Scratch | Readiness socket, shell activity, ephemeral files | No | Yes, tmpfs |
| `/opt/dsh`, `/opt/dsh-seed`, `/opt/dsh-tavern`, `/opt/dsh-source` | Immutable image | Runtime, seed, source, archive | No | Read-only; replaced by image |

## DSH-specific subtrees

- `$DSH_HOME/sessions` — durable JSONL session logs. These are state, not cache,
  despite being append-only diagnostics-like files. Back them up.
- `$DSH_HOME/storages` — durable JSON storage, including workspace/session
  metadata. Back it up.
- `$DSH_HOME/attachments/v1` — persistent content-addressed attachments. Back it
  up; attachments may contain personal data.
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

## Why this split

- Cache and logs can grow without warning. Keeping them in `/data` makes backup
  size, restore time and capacity planning unpredictable.
- Logs can contain prompts, configuration fragments or credentials. They are
  not part of recovery state and should have separate retention/access.
- Migration rollback copies contain credentials. They must not silently become
  part of the primary backup or be mistaken for an independent backup.
- `/workspace` is user data with a different size and snapshot cadence. It stays
  on its own volume, but backup consistency with `/data/dsh` still matters.
- `/data/dsh` and `/data/home` share one PVC to keep a single-owner snapshot
  simple. They can be split into separate PVCs later, but then backups must be
  coordinated and restored together.

## Migration behavior

On startup the entrypoint materializes state first, then:

1. moves a legacy `/data/cache` root once to
   `/cache/legacy-xdg-cache-<timestamp>-<pid>`;
2. creates `/cache/dsh`, moves an old real `$DSH_HOME/cache` once to
   `/cache/dsh/legacy-cache-<timestamp>-<pid>`, and symlinks the state path;
3. creates `/logs`, moves an old real `$DSH_HOME/logs` once to
   `/logs/legacy-logs-<timestamp>-<pid>`, and symlinks the state path;
4. leaves `/tmp` untouched (it is kernel/tmpfs scratch).

Deleting a legacy cache copy is safe after inspection. Legacy logs are retained
only for diagnosis; apply the same sensitivity policy as current logs. A
legacy `/data/dsh-migrations` directory is not moved automatically; exclude it
from state backups and remove it only after validating the current rollback
policy.

## Backup and restore policy

**Back up:** `/data/dsh`, `/data/home`, and `/workspace`. Use a filesystem
snapshot or stop DSH before tar/rsync. The three roots must be captured at a
consistent point; restoring only one can lose session metadata or project files.

**Do not include:** `/cache`, `/logs`, `/backups`, `/tmp`. If a tool snapshots
all of `/data`, exclude the cache/log symlinks (they point outside `/data`) and
any old `dsh-migrations` directory.

**Encrypt:** backups contain credentials, attachments and personal
conversations. Restrict access; never upload raw archives or startup logs to an
issue.

**Restore:** restore pre-upgrade `/data` and `/workspace` into separate target
volumes, restore the previous proxy/TLS configuration, and start the previous
pinned digest. Do not attach an old image to already migrated data. Do not run
two writers against one home.

**Verify:** mount the restored volumes into a disposable instance and confirm
profiles, credentials, sessions and a workspace file before cutover. A
successful container start is not proof of state correctness.

## Capacity guidance

Size `/data` for profiles, user plugins, sessions, attachments and Tavern data;
size `/workspace` independently for project data. Size `/cache` for package and
attachment caches, `/logs` for the desired retention, and `/backups` for one
migration copy plus headroom. Cache and logs are explicitly disposable; do not
let them consume the `/data` claim.
