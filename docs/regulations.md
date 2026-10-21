# Licensing and corresponding source

This is operational compliance guidance, not legal advice. Verify the current
upstream licenses and your own distribution obligations before redistributing
or operating the images.

## Distribution code

Original packaging, CI, documentation and `@soulwhisper/dsh-forward-auth` are licensed
under Apache-2.0; see the unchanged root [LICENSE](../LICENSE). This notice does
not relicense upstream software or dependencies.

## Bundled upstream components

Upstream components retain their own licenses and copyright notices. Installed
dependency trees retain their packaged license files. The root
[NOTICE](../NOTICE) records the DSH, market, ecosystem, Tavern and inspiration
notices. An OCI SBOM is an inventory, not a substitute for those licenses.

- DSH and DSH Market: MIT.
- Tavern ecosystem packages: MIT.
- Tavern itself: **AGPL-3.0-only**, not Apache-2.0 or MIT.

The distribution patches DSH Host/manager/app-boot and applies the recorded
Tavern route/theme modifications. Those modifications are not upstream
endorsements.

## Tavern corresponding source

The Tavern image retains:

- the complete modified Tavern source and original license at
  `/opt/dsh-tavern/apps/dsh-tavern`;
- the distribution build inputs at `/opt/dsh/distribution-source`;
- an authenticated archive at `/opt/dsh-source/tavern.tar.gz`, served at
  `/distribution/source.tar.gz` through the mandatory forward-auth gate;
- `DSH_SOURCE_URL`, identifying the distribution revision;
- the exact route/theme hashes in `versions.json`.

The archive contains the Tavern source and the whitelisted distribution build
inputs, including `distribution/docs/source-build.md` and
`distribution/docs/regulations.md`. It does not contain user state,
credentials, workspace data, installed `node_modules`, Git object databases,
test/smoke harnesses, deploy examples or CI workflows.

The authenticated download route is visible in the Tavern UI. Keep it
accessible to users of a deployed modified version. If you modify or
redistribute Tavern, preserve the AGPL license, notices, complete corresponding
source, build recipe and visible source offer. Distribution Apache-2.0 licensing
does not replace the Tavern AGPL license.

## Reproducibility and attestations

The build pins Node, pnpm, sources, patches, theme files and locks. The current
release index has no BuildKit provenance or SBOM attestation attached; verify
deployments by digest and preserve the previous digest plus volume snapshots.
Do not describe an unrun local build as a certified release.

## Secrets and user data

Source redistribution does not include any user state. Backups, startup logs,
cookies, credentials and model keys remain private data. Do not attach them to
issues or publish them in a source archive.
