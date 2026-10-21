# Local patches

Everything here modifies a pinned upstream artifact at image build time. No
vendored upstream source is edited in place and no patch is applied at runtime.

| Patch | Upstream pin | Contract |
| --- | --- | --- |
| `patches/dsh/patch-host.mjs` | DSH `0.2.1-rc.2` | SHA-256 per file (`host`, `types`, `manager`, `boot`) and exact anchors. Applies the pre-dispatch gate, startup audit readiness and manager protection. Unknown versions, altered inputs or already-patched files are rejected. |
| `patches/market/patch-market.mjs` | dshmarket `1.66.44` | Original/patched artifact hashes and one exact anchor. Routes market operations through the native manager. |
| `patches/tavern/patch-tavern.mjs` | Tavern commit `7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d` | Route source hash and exact anchors for the public-Origin fence. Also verifies the exact `@deepseek-ai/dsh-client-ui-theme` package version and both theme file hashes before invoking the upstream font helper. |

The route hash is `versions.json.tavern.routesSha256`; theme pins are under
`versions.json.tavern.theme`. The theme package is a runtime dependency, not a
Tavern source file, so the build checks both the package identity/version and
the exact files that receive the cosmetic font-limit change.

## Upstream update sequence

1. Update the version/commit and all coupled hashes in `versions.json`.
2. Recompute the exact source hashes and rebase only the local change.
3. Update the runtime/profile locks if the dependency graph changed.
4. Rebuild both images and run `node scripts/verify.mjs`,
   `node --test test/*.test.mjs` and the final-image smoke.
5. For Tavern, rebuild the source archive and verify the authenticated download
   still contains the modified source and build recipe.

A failure in this directory is an upstream break. Fix or revert the pin; do not
weaken a hash/anchor check, add a fallback, or move a patch into the runtime
plugin. A version-only Renovate PR is intentionally incomplete until the
coupled source, hashes and locks are updated by a human.
