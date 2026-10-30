# Upstream patches

Every patch modifies a pinned upstream artifact at image build time. No vendored
upstream source is edited in place and no patch is applied at runtime. A hash or
anchor mismatch is a build failure.

## Patch set

| Patch | Upstream pin | What it does |
| --- | --- | --- |
| `patches/dsh/patch-host.mjs` | DSH `0.2.1-rc.2` (Tavern) and `0.2.2-alpha.2` (Web) | Adds the mandatory pre-dispatch gate, startup-readiness marker and manager protection. Hashes four upstream files per release: host, types, manager and boot. |
| `patches/market/patch-market.mjs` | dshmarket `1.73.5` | Gives the Web market an `OfficialDesktopRuntime` backed by `pluginManager`, so package operations use manager admission instead of the CLI path. |
| `patches/tavern/patch-tavern.mjs` | Tavern commit `5deb1ef377240d0f41808a8e346040ff1def31d1` | Adds the exact public-Origin exception and applies the theme font-limit change. Verifies route and theme hashes. |
| `patches/wrongbook/patch-all.mjs` | Tavern commit `5deb1ef377240d0f41808a8e346040ff1def31d1` | Applies the wrongbook host patches whose anchors still match the pinned source: MVU pure-API tests and timeout body retention. Other upstream wrongbook patches are reported as not applicable. |
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
- App boot marks only `distribution-forward-auth` as required. Web bundled
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

### Wrongbook host patches

`dsh-tavern-wrongbook` normally re-applies its host patches at startup from
`<tavern data>/tools/mvu-api-test/patch-all.mjs`. That path is writable user
data, but the Tavern application root in this image is immutable. The build runs
the vendored subset against `/opt/apps/dsh-tavern` instead:

- MVU cards without card-owned scripts are allowed in pure-API tests;
- a timed-out pure-API card test keeps the foreground body it already received.

Most remaining upstream wrongbook patches target an older Tavern client/turn
tree; the card-generate patch is excluded because it targets user-owned card
data. They are listed as not applicable rather than applied with guessed anchors.
The same directory is seeded at startup when absent under
`$DSH_HOME/profile-data/tavern/data/tools/mvu-api-test` so the wrongbook panel
can report the real state; recognized upstream or image-managed copies are
migrated, custom copies are preserved, and runtime `--apply` is a no-op.

## Updating upstream

1. Update the version/commit and all coupled hashes in `versions.json`.
2. Recompute the exact source hashes and rebase only the local change.
3. Re-run `TAVERN_APP=/path/to/new/source node patches/wrongbook/patch-all.mjs --apply --strict`
   against the new source. Port or remove a patch when its anchor no longer
   matches; never weaken the anchor check.
4. Update the Tavern runtime/profile locks if that dependency graph changed;
   Web is build-resolved and has no committed lock.
5. Rebuild both images and run `node scripts/verify.mjs`,
   `node --test test/*.test.mjs` and the final-image smoke.
6. For Tavern, rebuild the source archive and verify the authenticated download
   still contains the modified source and build recipe.

A failure in this directory is an upstream break. Fix or revert the pin; do not
weaken a hash/anchor check, add a fallback, or move a patch into the runtime
plugin. A version-only Renovate PR is intentionally incomplete until the coupled
source, hashes and locks are updated by a human.
