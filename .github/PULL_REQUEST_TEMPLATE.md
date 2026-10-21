<!--
Every change lands through a reviewed PR. DSH is a developer preview and
upstream drift is expected: do not merge a version-only bump. Update the
source commit, patch hashes, locks, release tags and docs together.
-->

## Summary

<!-- One or two sentences describing the change. -->

## Changes

<!-- Bullet list. Call out patches, SSO behavior, image layout or release tags. -->

-

## Risk

<!-- What can break? Consider fail-open vs fail-closed, exact-hash patch
anchors, immutable runtime links, profile state migration, and AGPL source
availability. -->

## Testing

- [ ] `node scripts/verify.mjs`
- [ ] `node --test test/*.test.mjs`
- [ ] `node scripts/smoke.mjs dsh-web:local dsh-tavern:local` (when runtime, image, patch or dependency pins changed)
- [ ] `docker buildx build -f docker/Dockerfile --target web ...` and `--target tavern` (when build inputs changed)
- [ ] Profile locks were generated, normalized and reviewed — never hand-edited (when dependency pins changed)

## Release impact

- [ ] No image or release-tag change
- [ ] Web image/tag updated: `web-<dsh-version>` / `dsh-web:<dsh-version>`
- [ ] Tavern image/tag updated: `tavern-<tavern-version>` / `dsh-tavern:<tavern-version>`
- [ ] `versions.json` version, commit, hashes, release tag and docs move together

## Checklist

- [ ] Human review requested; no `automerge` or direct push to `main`
- [ ] No secrets, UIDs, credentials or private keys in code, logs or images
- [ ] SSO remains mandatory and fails closed; no OIDC or forwarded-IP trust added
- [ ] Upstream exact-hash patches were re-based deliberately, not loosened
- [ ] README/NOTICE/AGPL corresponding-source statements remain accurate
- [ ] No unrelated dependency or version churn
