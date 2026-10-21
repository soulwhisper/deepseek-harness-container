# Local patches

Everything here modifies a pinned upstream artifact at image build time. No
vendored upstream source is edited in place and no patch is applied at runtime.

| Patch | Upstream pin | Contract |
| --- | --- | --- |
| `dsh/patch-host.mjs` | DSH `0.2.1-rc.2` | Exact SHA-256 per file (`host`, `types`, `manager`, `boot`) and exact anchor strings. Applies the required pre-dispatch gate, startup audit readiness and native manager protection. Unknown versions, altered inputs or already-patched files are rejected. |
| `market/patch-market.mjs` | dshmarket `1.66.44` | Original and patched artifact hashes plus one exact anchor. Routes market operations through the real native manager instead of a CLI bypass. |
| `tavern/patch-tavern.mjs` | Tavern commit `7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d` | Route-source hash and exact anchors for the public-Origin fence, plus the recorded theme-font-limit helper. |

When an upstream pin changes:

1. Update the version/commit and hashes in `versions.json`.
2. Recompute the exact source hashes and rebase only the local change.
3. Update `docker/runtime` or `docker/profiles` locks if the dependency graph changed.
4. Run `node scripts/verify.mjs`, `node --test test/*.test.mjs` and the final-image smoke.

A failure in this directory is an upstream break. Fix or revert the pin; do not
weaken the hash/anchor checks or move the patch into the runtime plugin.
