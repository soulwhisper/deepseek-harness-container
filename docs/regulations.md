# Licensing and corresponding source

!!! note "Compliance guidance, not legal advice"
    Verify the current upstream licenses and your own distribution obligations
    before redistributing or operating the images.

## Our code

Original packaging, CI, documentation and the `@soulwhisper/dsh-forward-auth`
implementation are licensed under Apache-2.0. The unchanged root
[LICENSE](https://github.com/soulwhisper/deepseek-harness-container/blob/main/LICENSE),
`plugins/forward-auth/LICENSE` and the package's
`"license": "Apache-2.0"` metadata all express that.

The authentication plugin's own `.mjs` files carry
`SPDX-License-Identifier: Apache-2.0`. No upstream DSH source is vendored in the
plugin package. The separate `patches/dsh/upstream-MIT-LICENSE` file is **not**
a license for the plugin; it preserves the MIT notice for the pinned DeepSeek
Harness source that the distribution patches and redistributes. Apache-2.0 is
compatible with that MIT-licensed upstream, but it does not relicense it. Keep
the MIT notice and the upstream copyright.

Tavern is a separate component and is **AGPL-3.0-only**, not MIT; its complete
source and license remain in the Tavern image and source archive.

This distinction also appears in the root
[NOTICE](https://github.com/soulwhisper/deepseek-harness-container/blob/main/NOTICE): distribution code
is Apache-2.0; bundled upstream components keep their own licenses.

## Bundled upstream components

| Component | License | Notes |
| --- | --- | --- |
| DeepSeek Harness | MIT | Host/manager/app-boot patched at build time; upstream notice retained |
| DSH Market | MIT | Managed-runtime bridge patch applied |
| `dsh-context` 0.78.1 | Apache-2.0 | Web only; packaged LICENSE retained |
| `dsh-mnemon` 0.5.37 | MIT | Web only; packaged LICENSE retained |
| `@mnemon-dev/mnemon` 0.2.13 CLI | Apache-2.0 | Web only; installed globally with its LICENSE |
| `@michengai/dsh-automation` 1.0.13 | Apache-2.0 | Web only; packaged LICENSE retained |
| `@xmanrui/dsh-im` 5.8.0 | MIT | Web only; packaged LICENSE retained |
| `dsh-better-sidebar` 0.28.2 | MIT | Web only; packaged LICENSE retained |
| `@linxin666/dsh-ssh` 0.4.12 | Apache-2.0 | Web only; packaged LICENSE retained |
| Caveman skill | Apache-2.0 | Web only; fetched from the latest upstream GitHub release tag at build time (not `main`); `LICENSE` and `NOTICE` retained in the skill seed |
| RTK OSS | Apache-2.0 | Web only; `rtk-oss-*` release asset only; the BUSL-1.1 edition is not bundled; LICENSE retained |
| Tavern ecosystem packages | MIT | Installed in the Tavern image only |
| Tavern bundled scene-image plugin | MIT | Inside the Tavern source; installed into Tavern data on first boot; package LICENSE retained |
| Tavern itself | **AGPL-3.0-only** | Not Apache-2.0 or MIT |

Installed dependency trees retain their packaged license files. The root
[NOTICE](../NOTICE) records the DSH, market, ecosystem, Tavern and inspiration
notices. An OCI SBOM is an inventory, not a substitute for those licenses.
The Web image retains the bundled plugins' license/notice files under the
writable Web profile `node_modules` seed, the global Mnemon CLI package under
`/usr/local/lib/node_modules/@mnemon-dev/mnemon`, Caveman under the skill seed,
and RTK under `/usr/local/share/rtk`. Tavern does not include them.

The distribution patches DSH Host/manager/app-boot and applies the recorded
Tavern route/theme modifications. Those modifications are not upstream
endorsements.

## Tavern corresponding source

The Tavern image retains:

- the complete modified Tavern source and original license at
  `/opt/apps/dsh-tavern`;
- the distribution build inputs at `/opt/dsh/distribution-source`;
- an authenticated archive at `/opt/dsh/source/tavern.tar.gz`, served at
  `/distribution/source.tar.gz` through the mandatory forward-auth gate;
- `DSH_SOURCE_URL`, identifying the distribution revision;
- the exact route/theme hashes in `versions.json` and the vendored wrongbook
  host-patch anchors under `distribution/patches/wrongbook/`.

The archive contains the Tavern source and the whitelisted distribution build
inputs, including `distribution/docs/source-build.md` and
`distribution/docs/regulations.md`. It does not contain user state, credentials,
workspace data, installed `node_modules`, Git object databases, test/smoke
harnesses, deploy examples or CI workflows.

The authenticated download route is visible in the Tavern UI. Keep it accessible
to users of a deployed modified version. If you modify or redistribute Tavern,
preserve the AGPL license, notices, complete corresponding source, build recipe
and visible source offer. Distribution Apache-2.0 licensing does not replace the
Tavern AGPL license. See [Corresponding source](source-build.md).

## Reproducibility and attestations

The build pins Node, pnpm, DSH/Tavern sources, patches, theme files and the
Tavern profile/runtime locks. Web top-level plugin versions are exact pins in
the profile recipe, but the Web runtime/profile has no lock, so transitive
dependencies and the Caveman/RTK release tags are resolved at build time.
Exact-bytes reproduction therefore requires the same upstream state or the
published image digest; Tavern remains fully locked. The current release index
has no BuildKit provenance or SBOM attestation attached; verify deployments by
digest and preserve the previous digest plus volume snapshots. Do not describe
an unrun local build as a certified release.

## Secrets and user data

Source redistribution does not include any user state. Backups, startup logs,
cookies, credentials and model keys remain private data. Do not attach them to
issues or publish them in a source archive.
