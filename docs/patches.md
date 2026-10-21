# Upstream patches

Every patch modifies a pinned upstream artifact at image build time. No vendored
upstream source is edited in place and no patch is applied at runtime. A hash or
anchor mismatch is a build failure.

## Patch set

| Patch | Upstream pin | What it does |
| --- | --- | --- |
| `patches/dsh/patch-host.mjs` | DSH `0.2.1-rc.2` | Adds the mandatory pre-dispatch gate, startup-readiness marker and manager protection. Hashes four upstream files: host, types, manager and boot. |
| `patches/market/patch-market.mjs` | dshmarket `1.66.44` | Gives the Web market an `OfficialDesktopRuntime` backed by `pluginManager`, so package operations use manager admission instead of the CLI path. |
| `patches/tavern/patch-tavern.mjs` | Tavern commit `7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d` | Adds the exact public-Origin exception and applies the theme font-limit change. Verifies route and theme hashes. |
| Tavern profile patch | `dsh-better-sidebar@0.28.0` | Fixes the thread seed boundary so a resume does not drop pre-resume history. Applied by pnpm from the Tavern recipe and pinned by the lock's `patch_hash`. |

## Why each patch exists

### Host gate and boot policy

DSH does not provide a mandatory “authenticate before any route” hook. A plugin
can register routes, but upstream cannot guarantee that it runs first, that it
cannot be disabled, that WebSocket upgrades are gated, or that a missing auth
component fails closed.

The Host patch adds that guarantee:

- `registerRequiredAccessGate()` accepts one synchronous gate.
- The gate runs before HTTP dispatch and before `upgrade`.
- A missing gate or gate exception leaves the listener denied with 503.
- Shutdown destroys tracked sockets.
- App boot marks only `distribution-forward-auth` as required. Web floating
  plugins, including `dsh-market` and `dsh-context`, remain removable
  recommendations. If forward-auth never registers, the Host gate still denies
  all traffic.
- The manager protects forward-auth, app-boot and Tavern's
  `dshTavern.managedBundles`/plugin rows from disable/removal and direct
  known-spec installation. Tavern pinned ecosystem entries are restored from
  the immutable seed on restart.

The local plugin is not the patch. It registers the gate through the patched API.
See [Authentication](forward-auth.md).

### Market admission bridge

The Web market is a package manager. Its upstream Web branch is handed no managed
runtime, so it can fall back to a CLI subprocess. That path bypasses the
distribution's native manager admission and protected modules. The patch supplies
`createOfficialDesktopRuntime(() => hostCtx.get('pluginManager'), ...)` and
disposes it with the routes. It does not add a second package manager.

### Tavern compatibility

Tavern has its own HTTP server and Origin fence, independent of the DSH Host gate.
Behind the public proxy, its internal Origin comparison rejects legitimate
same-origin browser requests. The patch allows only:

- the exact `DSH_PUBLIC_URL` origin;
- a matching `Host`; and
- a non-cross-site `Sec-Fetch-Site`.

It does not trust forwarded headers alone. The theme change raises only the
content font maximum from 22 to 32; code and terminal limits stay unchanged. The
font change is cosmetic, but a theme package or file hash mismatch fails the
build before the change is applied.

### Sidebar history fix

`dsh-better-sidebar` is a Tavern dependency. DSH 0.2 marks the seed boundary with
`{ inherited: true }` and appends a plain `session/end-seed` on every resume.
The upstream logic cut at the last marker, which dropped the thread's history from
before the resume. The pnpm patch selects the inherited marker first. It is a
data-loss fix, not a security boundary, and applies only where that package is
installed.

## Updating upstream

1. Update the version/commit and all coupled hashes in `versions.json`.
2. Recompute the exact source hashes and rebase only the local change.
3. Update runtime/profile locks if the dependency graph changed.
4. Rebuild both images and run `node scripts/verify.mjs`,
   `node --test test/*.test.mjs` and the final-image smoke.
5. For Tavern, rebuild the source archive and verify the authenticated download
   still contains the modified source and build recipe.

A failure in this directory is an upstream break. Fix or revert the pin; do not
weaken a hash/anchor check, add a fallback, or move a patch into the runtime
plugin. A version-only Renovate PR is intentionally incomplete until the coupled
source, hashes and locks are updated by a human.
