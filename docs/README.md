# Documentation

This distribution keeps the root README short and the operating contracts in
this directory. `handoff-*.md` files are local working notes and are ignored by
Git.

## Start here

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Images, profiles, trust boundary and repository drift surfaces |
| [Constraints](constraints.md) | Security, compatibility and deployment rules that must not move silently |
| [Build](build.md) | Docker targets, source payload, locks and native architecture |
| [Deploy](deploy.md) | Compose and Kubernetes application-side examples |
| [Operations](operations.md) | First boot, migration, backup, restore and rollback |
| [Data layout](data-layout.md) | What is durable, cache, logs, rollback or temporary |
| [Patches](patches.md) | Exact-hash upstream modifications |
| [Source build](source-build.md) | Tavern corresponding source and rebuild recipe |
| [Regulations](regulations.md) | Apache/MIT/AGPL licensing and source-offer obligations |
| [OIDC connector plan](oidc-connector-plan.md) | Path from the trusted-header gate to a generic OIDC RP |
| [HA plan](ha-plan.md) | Replica, PDB and shared-RWX evaluation; DSH hot-switch limits |

## Documentation rules

- Product claims must correspond to a checked image, workflow or script; use
  the exact commit or image digest when describing a build.
- Security-boundary changes need a corresponding test and an exact pin update.
- Upstream drift belongs to `patches/`, package pins in `versions.json`, or a
  profile recipe in `docker/`; do not hide it in prose.
- Do not commit a handoff file. Put durable decisions in one of the documents
  above and leave transient status in the ignored handoff.
