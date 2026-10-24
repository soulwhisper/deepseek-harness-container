# Marketplace build approvals

This page records the build-script evaluation for community plugins installed
from the DSH market. It is a decision record and a test worksheet, not an
approval: no plugin below is trusted, bundled or allowed by this document.

The operator will test the planned plugins first, then extend the
[planned plugins](#planned-plugins) table. A separate change will decide whether
any `allowBuilds` entry is pre-seeded.

## Why this exists

DSH Web ships the market, but the market is not a privileged installer. pnpm 10
and newer block dependency lifecycle scripts by default. A plugin whose
dependency needs `install`, `preinstall` or `postinstall` therefore either:

- installs with an "ignored build scripts" result and fails later when the
  native artifact is missing; or
- reports the blocked package and lets the owner approve it, after which pnpm
  reruns the operation.

The market already implements the second path. The profile's
`pnpm-workspace.yaml` is the durable approval record.

## What `allowBuilds` keys are

`allowBuilds` is keyed by the **package that owns the lifecycle script**, not by
the plugin that depends on it. Examples:

```yaml
allowBuilds:
  node-pty: true
  better-sqlite3: true
  '@scope/plugin-with-postinstall': true
```

Adding a plugin name for a dependency's script does nothing. For a git-hosted
plugin, pnpm may key the decision by the remote, for example
`name@git+https://github.com/owner/repo#<commit>`; the market derives that key
from pnpm's own output.

Version-scoped keys such as `better-sqlite3@12.11.1` are valid, but the market
writes bare package names. Keep version pins in the planned-plugin table if a
specific version is the only tested one.

## Current profile configuration

```yaml
# docker/profiles/web/pnpm-workspace.yaml
allowBuilds:
  node-pty: false
```

```yaml
# docker/profiles/tavern/pnpm-workspace.yaml
allowBuilds:
  node-pty: false
```

```yaml
# docker/runtime/pnpm-workspace.yaml
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  koffi: true
  node-pty: true
  '@google/genai': false
  protobufjs: false
```

The runtime allowlist is image-build policy. The Web/Tavern profiles are what
the market and `dsh plugin` mutate after install.

`node-pty: false` is an explicit denial, not merely an absent default. It affects
terminal plugins that bring their own `node-pty` dependency. The host runtime
already contains `node-pty@1.2.0-beta.15` with linux-x64 and linux-arm64
prebuilds, but a profile plugin cannot resolve that copy unless the profile
links or overrides it.

## What the market does today

- The market runs profile package operations with pnpm and reads the reported
  ignored builds.
- `approve-builds` writes the selected package names to the active profile's
  `allowBuilds` and retries the operation.
- The UI warns that community plugins do not run build scripts by default.
- The seed merge in `scripts/materialize-state.mjs` currently lets the seed
  `allowBuilds` values overwrite the profile's existing values:

  ```js
  allowBuilds: { ...previousWorkspace?.allowBuilds, ...seedWorkspace.allowBuilds }
  ```

  A user-approved `node-pty: true` is therefore reset to the seed's `false` on a
  distribution migration. This page records the gap; it does not change it.

## Candidate reference

The labels below describe what was observed in the package manifest, not a
runtime test.

### Terminal plugins: `node-pty`

`node-pty` ships prebuilds for linux-x64 and linux-arm64. Its install script
checks those prebuilds; a blocked script is usually an approval/visibility
problem, not a compiler requirement. The explicit `node-pty: false` in the
profile means this class needs attention before it can be supported.

| Catalog entry | Package / version | Note |
| --- | --- | --- |
| `dsh-workspace` | GitHub Release tarball `dsh-workspace-0.1.0.tgz` | `node-pty ^1.1.0`; not an npm catalog entry |
| `dsh-workbench-layout` | `@lsq64737/dsh-workbench-layout@0.1.9` | `node-pty ^1.1.0` |
| `dsh-bash-terminal-ts` | `dsh-bash-terminal-ts@0.8.2` | `node-pty 1.2.0-beta.15` |
| `dsh-vscode-workbench` | `dsh-vscode-workbench@0.1.9` | `node-pty ^1.1.0` |
| `dsh-better-sidebar-N23` | `@all3cn/dsh-better-sidebar-n23@0.1.0` | `node-pty ^1.1.0` |
| `dsh-plugin-terminal` | `dsh-plugin-terminal@0.2.0` | `node-pty ^1.1.0` |
| `dsh-bash-terminal` | `dsh-bash-terminal@0.3.15` | `node-pty ^1.1.0` |
| `terminal` | `dsh-terminal@0.1.1` | `node-pty ^1.1.0` |
| `dsh-zterm` | `dsh-zterm@0.1.15` | `node-pty 1.1.0` plus its own `postinstall` |
| `dsh-harness-switch` | `dsh-harness-switch@0.3.3` | `node-pty ^1.1.0` |

The pinned Tavern `dsh-better-sidebar@0.28.0` is **not** in this group. It has no
native dependency; its terminal is provided by the DSH host.

### Hard native artifacts

These dependencies obtain a native binary from their install lifecycle. A
blocked script leaves the package without a usable binary unless a prebuilt
optional package happens to cover it.

| Dependency | Catalog plugins | Note |
| --- | --- | --- |
| `better-sqlite3` | `dsh-search-index@0.6.6`, `dsh-session-steward@0.5.6` (12.11.1); `dsh-git-server@0.2.4`, `LiuHe#bundle` / `@jieai/dsh-malong-bridge@0.5.27` (11.x) | 11/12 use `prebuild-install`; `13.0.3` currently has no install script |
| `koffi` | `dsh-plugin-multi-root-workspace@0.1.9`, `dsh-port-inspector@0.1.2`, `dsh-session-bin@0.2.4`, `dsh-keep-awake@0.4.1` | `install` runs `cnoke --prebuild` |
| `onnxruntime-node` | `dsh-asr-plugin@0.1.3`, `dsh-meeting-room@0.1.0-preview.6` | `postinstall` installs the native runtime |
| `esbuild` | `@zzerx/dsh-plugin-usage-billing@1.3.0` | `postinstall` selects a platform binary; optional package may make this less strict |

### Plugins with their own lifecycle script

The key is the plugin package name itself. Whether it is required depends on
what the script does; the market will still ask before running it.

| Catalog entry | Package / version | Script |
| --- | --- | --- |
| `dsh-tui-pi` | `@aiwayds/dsh-tui-pi@2.29.0` | `postinstall`: link the DSH closure |
| `dsh-subagent-registry` | `@aiwayds/dsh-subagent-registry@0.14.1` | `postinstall`: link the DSH closure |
| `dsh-zterm` | `dsh-zterm@0.1.15` | `postinstall`: prepare native, plus `node-pty` |
| `dsh-vision-proxy` | `dsh-vision-proxy@0.4.1` | `postinstall`, plus `sharp ^0.34` |
| `dsh-plugin-writing-guard` | `dsh-plugin-writing-guard@2.0.1` | `postinstall`: install extras |
| `dsh-graft-plugin` | `dsh-graft-plugin@0.2.1` | `postinstall` |
| `dsh-doctor` | `@jorinyang/dsh-doctor@0.3.2` | `postinstall` |
| `gitnexus-plus` | `dsh-gitnexus-plus@0.1.6` | `postinstall`: link runtime |
| `dsh-experimental-computer-use-linux-nde-mcp` | `@ashtonsun/dsh-experimental-computer-use-linux-nde-mcp@0.2.10` | `postinstall`: install binary |
| `huaweicloud-devkit` | `huaweicloud-devkit@1.1.10` | `postinstall` |
| `get-fable` | `get-fable@1.14.0` | `postinstall` |
| `dsh-free-vision` | `dsh-free-vision@1.0.8` | `postinstall`: patch luma |
| `hermes-dsh-bridge` | `hermes-dsh-bridge@0.11.4` | `postinstall`: link host deps; reports a recoverable failure |
| `dsh-harmony` | `dsh-harmony@0.8.18` | `postinstall` only when `npm_config_global=true` |
| `dsh-desktop-pet` | `dsh-desktop-pet@0.2.0` | `postinstall`: install Neutralino; desktop-only |
| `dsh-desktop-tools` | `dsh-desktop-tools@0.5.3` | `postinstall`: ensure host; desktop-only |
| `dsh-browser4` | `dsh-browser4@0.0.1` | `postinstall`: install a browser; the image does not ship one |

### No build approval expected

| Dependency or class | Reason |
| --- | --- |
| `sharp >= 0.35` | No install script; platform binaries are optional packages |
| `sharp 0.33/0.34` | `install/check` only checks prebuilt/libvips state, it does not build |
| `sqlite-vec` | No install script; platform binaries are optional packages |
| `@napi-rs/canvas` | No install script; platform binaries are optional packages |
| `lightningcss` | Only `prepare`; registry installs do not run it |
| `playwright` / `playwright-core` | No install script; browsers are installed separately and are absent |
| `puppeteer-core` | No install script; browsers are absent |

`prepare` is not an npm-registry install script. It matters for `github:` and
local directory sources, where the market handles it as a git-source approval.
A prebuilt GitHub Release tarball can avoid it; that is a source decision, not
an `allowBuilds` decision.

## Planned plugins

Add one row per plugin the operator actually wants to support. Do not add a row
to the profile's `allowBuilds` just because the plugin appears in this catalog.
Test first, then decide.

| Plugin | Catalog / source | Required key(s) | Artifact | Tested version | amd64 | arm64 | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Leave `Decision` empty until the plugin has a tested source, a tested native
artifact and a conscious policy choice. If a plugin brings several build keys,
list each key separately.

## How to allow a tested plugin

1. **Default: per-install approval.** Install through the market, let pnpm
   report the blocked package, approve it in the UI, restart and exercise the
   plugin. This is the least privileged path and needs no image change.
2. **Pre-approve only a dependency, and only after testing.** Use the package
   key from pnpm's report, for example `node-pty: true`. Never use the plugin
   name for a dependency's script.
3. **Prefer a pinned plugin and a tested artifact.** A native artifact built for
   Node 24 and the target architecture is not interchangeable with an arbitrary
   future version.
4. **Keep the allowlist minimal.** Pre-approving a package authorizes every
   plugin in that profile to run that package's script, not only the plugin
   being tested.
5. **Fix the upgrade path before relying on approvals.** The seed-over-profile
   merge must preserve user-approved keys, or every migration will silently
   remove them. Do not pre-seed `false` for packages users are expected to
   approve; absent means the pnpm default denial.

`node-pty` is the only package with a low-cost case for pre-approval: its
prebuilds are bundled, so approval does not require a compiler or a download.
It is still a native module and a per-profile duplicate of the runtime copy.

## Verification matrix

For each planned plugin:

1. Fresh profile; install the pinned version with the market.
2. Record the exact blocked package names from pnpm.
3. Approve, then confirm `pnpm-workspace.yaml` contains the expected keys.
4. Restart the profile and exercise the feature that needs the native artifact.
5. Repeat on amd64 and arm64; do not infer arm64 from amd64 for native modules.
6. Run the distribution migration/upgrade and confirm the approval survives.
7. Uninstall; confirm the plugin and its unnecessary approval entries can be
   removed without breaking other plugins.

## Open questions

- Which terminal plugins are in the planned plugin set? That decides whether
  `node-pty` should be pre-approved or left to per-install approval.
- Are `better-sqlite3`, `koffi` and `onnxruntime-node` acceptable as
  user-approved native downloads, or should their plugins be marked
  unsupported until a prebuilt artifact is verified for Node 24 on both
  architectures?
- Should the market surface "no native artifact" as a compatibility warning
  before install? It currently reports failures after the fact.
- Should the profile seed stop writing explicit `false` entries and rely on the
  pnpm default, so user approvals are not overwritten?

## Evidence and scope

Catalog snapshot: `https://awesome-dsh-plugin.com/plugins.json`, 2026-10-22,
6,378 entries. The scan read 3,280 npm manifests plus the `dsh-workspace` GitHub
package manifest. The remaining 3,098 GitHub-only entries were not enumerated;
their `prepare` requirements surface through the market's git-source approval
flow. Versions and scripts are observations from that date, not a promise about
future releases.

Related sources:

- `docker/profiles/web/pnpm-workspace.yaml`
- `docker/profiles/tavern/pnpm-workspace.yaml`
- `docker/runtime/pnpm-workspace.yaml`
- `scripts/materialize-state.mjs`
- dshmarket `lib/profile.js` (`setAllowBuilds`) and `lib/routes.js`
  (`/dsh-market/approve-builds`)
