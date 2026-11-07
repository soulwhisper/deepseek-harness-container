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
| `dsh-context` 0.82.0 | Apache-2.0 | Web only; packaged LICENSE retained |
| `dsh-mnemon` 0.5.41 | MIT | Web only; packaged LICENSE retained |
| `@mnemon-dev/mnemon` 0.2.13 CLI | Apache-2.0 | Web only; installed globally with its LICENSE |
| `@michengai/dsh-automation` 1.0.18 | Apache-2.0 | Web only; packaged LICENSE retained |
| `@xmanrui/dsh-im` 5.8.0 | MIT | Web only; packaged LICENSE retained |
| `dsh-better-sidebar` 0.30.1 | MIT | Web only; packaged LICENSE retained |
| `@linxin666/dsh-ssh` 0.4.15 | Apache-2.0 | Web only; packaged LICENSE retained |
| `dsh-session-manager` 0.7.5 | MIT | Web only; packaged LICENSE retained |
| Caveman skill | Apache-2.0 | Web only; fetched from the latest upstream GitHub release tag at build time (not `main`); `LICENSE` and `NOTICE` retained in the skill seed |
| RTK OSS | Apache-2.0 | Web only; `rtk-oss-*` release asset only; the BUSL-1.1 edition is not bundled; LICENSE retained |
| Tavern bundled scene-image plugin | MIT | Inside the Tavern source; installed into Tavern data on first boot; package LICENSE retained |
| sharp 0.34.5 + `@img/sharp-libvips-*` 1.2.4 | Apache-2.0; LGPL-3.0-or-later and bundled third-party licenses | Tavern runtime; native dependency of the Tavern asset library; sharp LICENSE and the libvips package README license inventory are retained in the runtime closure |
| Tavern itself | **AGPL-3.0-only** | Not Apache-2.0 or MIT |

Installed dependency trees retain their packaged license files. The root
[NOTICE](../NOTICE) records the DSH, market, Tavern and inspiration notices. An OCI SBOM is an inventory, not a substitute for those licenses.
The Web image retains the bundled plugins' license/notice files under the
writable Web profile `node_modules` seed, the global Mnemon CLI package under
`/usr/local/lib/node_modules/@mnemon-dev/mnemon`, Caveman under the skill seed,
and RTK under `/usr/local/share/rtk`. Tavern does not include them.

The distribution patches DSH Host/manager/app-boot, verifies the recorded
Tavern route/theme hashes and applies upstream's installer font-limit helper to
the host theme. The Tavern route source is not modified. Those changes are not
upstream endorsements.

## Tavern corresponding source

The Tavern image retains:

- the complete modified Tavern source and original license at
  `/opt/apps/dsh-tavern`;
- the distribution build inputs at `/opt/dsh/distribution-source`;
- an authenticated archive at `/opt/dsh/source/tavern.tar.gz`, served at
  `/distribution/source.tar.gz` through the mandatory forward-auth gate;
- `DSH_SOURCE_URL`, identifying the distribution revision;
- the exact route/theme hashes in `versions.json`.

The archive contains the Tavern source and the whitelisted distribution build
inputs, including `distribution/docs/source-build.md` and
`distribution/docs/regulations.md`. It does not contain user state, credentials,
workspace data, installed `node_modules`, Git object databases, test/smoke
harnesses, deploy examples or CI workflows.

The authenticated download route is served at `/distribution/source.tar.gz`.
The image deliberately does not inject a notice into the Tavern index because
that injection did not work; the route itself is the corresponding-source offer.
Operators must make it visibly available to network users, for example by linking
the authenticated route from their deployment UI or documentation. If you modify
or redistribute Tavern, preserve the AGPL license, notices, complete
corresponding source, build recipe and corresponding-source download. Distribution Apache-2.0 licensing does not replace the
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
