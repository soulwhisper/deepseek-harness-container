# HA limits

!!! info "Current status"
    Evaluation only. There is no active-active migration. The recommended
    deployment is one StatefulSet replica with RWO `/data` and `/workspace`
    claims.

## Decision

- Keep **one** DSH process per home.
- Keep RWO storage for the live Pod.
- Do **not** scale the StatefulSet to two replicas.
- Do **not** use a shared RWX home as hot failover or a load-balancing volume.
- A PDB is optional and protects only voluntary disruptions; it is not HA.
- Use external, consistent snapshots for recovery. `/backups` is a local
  migration rollback copy, not an independent backup.

This is a limitation of DSH's state and lifecycle model, not a missing Kubernetes
feature.

## What DSH actually persists

- Session logs: `$DSH_HOME/sessions`, per-session append-only JSONL, with
  immutable historical generations and crash recovery.
- Workspace/session metadata and other storage: `$DSH_HOME/storages`.
- Attachments: `$DSH_HOME/attachments/v1`.
- Profiles, credentials, native cookie signing secret and installed user
  plugins: `$DSH_HOME`.
- DSH's hard-coded cache and startup logs are symlinked to `/cache` and `/logs`.

The native cookie signing secret is stored in DSH credentials, so a browser
cookie can survive a process restart when the same home is mounted. That does not
make a live process transferable.

## Why active-active is not supported

- **Per-session, not home-wide locking.** `dsh-session-persistence-jsonl` uses a
  non-blocking kernel `flock` for one session's write ownership and raises
  `SessionAlreadyOwnedError` while a live writer holds it. There is no home-wide
  lease or leader election. Two starters can still race on profiles, storage,
  attachments, the native manager and user plugin installation.
- **Live state is in the process.** Agent turns, tool subprocesses, PTYs,
  WebSocket connections, in-flight model calls and the DSH manager are not
  serialized into the session log as transferable runtime state.
- **Durable sessions are recoverable, not hot.** A restarted process can resume
  from session logs and repair an interrupted turn, but it does not inherit the
  old process's live turn, PTY, job or connection. The session lock also blocks a
  second live writer until the old process exits.
- **No shared-state backend.** The default session search database is `:memory:`;
  there is no distributed session/event store or cross-pod message bus. Sharing
  RWX storage does not create one.
- **Startup mutates state.** State materialization, managed links, profile merges
  and the native manager can write during boot. Two starts against one home are
  not a supported coordination protocol.
- **RWX filesystems vary.** DSH relies on POSIX kernel `flock` semantics. NFS/SMB
  and some CSI implementations may not provide the same exclusion, atomic rename
  or mmap behavior. “Mounts on both Pods” is not a correctness proof.

## Failure behavior

| Event | Behavior |
| --- | --- |
| Process crash | Kernel locks release on process death. A new process on the same home can open sessions; committed logs survive, the interrupted turn is repaired. |
| Pod/node loss | RWO volume reattaches after reschedule. Browser cookie can remain valid because its signing secret is in credentials, but the client must reconnect and any live turn/PTY/job is lost. |
| Rolling image update | StatefulSet terminates the existing single Pod before creating the replacement. No second writer should exist. |
| Two replicas | Each Pod has its own listener and in-memory sessions. They are not HA replicas; they can race on the same home. Do not do this. |
| Hot switch to another Pod | Not supported. A live session is locked by the old writer; WebSocket/PTY/turn state is not migrated. |

A client reconnect after a real process exit is not a “hot switch”; it is session
resume from durable logs.

## Options considered

| Option | Replicas | Storage | Availability property | Verdict |
| --- | --- | --- | --- | --- |
| Current single StatefulSet | 1 | RWO `/data`, `/workspace` | Pod restart/reschedule; manual recovery | Recommended |
| Single StatefulSet + PDB | 1 | RWO | Blocks voluntary eviction; no protection from node failure | Optional, operationally costly |
| Active/passive with RWX | 2 | RWX shared home | Requires external leader/drain and app support | Not supported today |
| Active/active with RWX | 2+ | RWX shared home | Load balancing across replicas | Reject: state races and no live handoff |
| Independent instances per owner | N | Separate homes | Scales owners/users, not availability | Only for isolation or capacity |

## PDB

With one replica, `minAvailable: 1` can protect against voluntary eviction but
will block or delay `kubectl drain`, node upgrades and some maintenance. It does
not help when the node or Pod fails. If your operations team accepts that
tradeoff, add it explicitly:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: dsh-web
  namespace: dsh
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: dsh-web
```

Do not add a PDB as a substitute for replicas. With a single replica it is a
maintenance guard, not an availability mechanism. With active/passive it still
requires an external controller to ensure the standby never opens the home while
the active writer lives.

## Shared RWX

RWX is acceptable for read-only source/archive distribution, separate snapshot
staging or an external backup target. It is not acceptable for a live DSH home
today because:

- the session lock excludes only a session, not profile/storage/manager writes;
- the attachment and storage backends assume a single process's write ordering;
- there is no startup lease that prevents two DSH processes from materializing or
  mutating the same home;
- Kubernetes will not infer the application-level single-writer contract from
  `ReadWriteMany`.

If an active/passive experiment is pursued, it needs at minimum:

1. An external leader lease acquired before any DSH process starts.
2. A drain endpoint that stops accepting work, closes live streams and waits for
   session handles and subprocesses to finish.
3. Edge routing that can move between Pods without changing Host/Origin or
   bypassing forward-auth.
4. A tested RWX backend with POSIX `flock`, atomic rename and fsync semantics.
5. Recovery tests for crash before/after lock release, profile migration and
   source/attachment writes.

Until those exist, RWX failover is an experiment, not a deployment option.

## Recommended availability work

1. Keep `/data` and `/workspace` on RWO PVCs and pin the image digest.
2. Take consistent external snapshots of both roots; test restore monthly or
   before every upgrade.
3. Keep the previous image digest and the pre-upgrade snapshots.
4. Use `Recreate`/single-Pod semantics; never two writers.
5. If maintenance windows matter, apply the optional PDB and coordinate drains.
6. Add alerting for Pod readiness, restart count, volume attachment and backup
   age.
7. Revisit active/passive only with an upstream-supported leader/drain contract
   or a custom supervisor with the tests above.

## Unsupported claims

- “RWX plus two replicas is HA”: no; it is unsynchronized shared state.
- “The session log is the live session”: no; it is durable history, not process
  state.
- “The browser cookie survives, therefore the session moves”: no; the cookie
  survives, the live turn/PTY/job does not.
- “A PDB makes a single replica highly available”: no; it protects voluntary
  disruption only.
