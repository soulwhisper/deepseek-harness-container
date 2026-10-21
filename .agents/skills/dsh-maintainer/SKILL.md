---
name: dsh-maintainer
description: >
  Use when changing, building, verifying or releasing this DeepSeek Harness
  container distribution. Records the Web/Tavern optional-asset boundary,
  floating upstream inputs, patch ordering and CI-only image verification.
---
# DSH distribution maintenance

This is a repository-maintainer skill. Do not move it to `docker/skills/`; that
directory is seeded into the Web image as user-facing skills.

## Core rules

- Use GitHub Actions for image builds and final-image smoke. Do not build
  images locally by default: the local VM and network are limited.
- Local verification is limited to cheap static checks:
  `node scripts/verify.mjs` and `node --test test/*.test.mjs`.
- The authoritative image check is the GitHub Actions matrix:
  Web and Tavern, each on native amd64 and arm64, followed by
  `CI checks passed`.
- Deploy and compare published image digests, not mutable tags.

## Web and Tavern boundary

- The Web image owns all optional assets:
  - `dsh-context`
  - Caveman skill seed
  - RTK OSS binary and RTK skill seed
- The Tavern image owns none of those optional assets. Its profile keeps the
  Tavern distribution and ecosystem only.
- `scripts/verify-runtime.mjs` must keep asserting the Tavern absences and the
  Web assets.
- The shared `distribution-source` payload may contain build recipes for the
  Web-only assets; that is source material, not active Tavern runtime content.
- Do not remove Tavern's own ecosystem packages when tightening this boundary.

## Floating optional assets

These upstream inputs are deliberately **not version-pinned** in this
repository:

| Asset | Source | Resolution |
| --- | --- | --- |
| `dsh-context` | npm `latest` | Installed into the immutable Web runtime, linked into the Web profile |
| Caveman skill | `JuliusBrussee/caveman` `main` | Fetched into the Web seed; upstream LICENSE and NOTICE retained |
| RTK | `rtk-ai/rtk` latest release, `rtk-oss-*` only | Verified and installed into the Web image |

Rules:

- Do not add versions for these three to `versions.json` or Renovate.
- Do not add `latest` image tags. The image digest is the reproducibility
  boundary for the floating bytes.
- Do not add these to committed profile locks; the Web build regenerates the
  in-image profile lock with `--no-frozen-lockfile`.
- Docker layers may cache old upstream bytes. Use a clean runner or bypass the
  relevant build cache when an explicit refresh is required.

## dsh-context

Build order matters:

1. Install the latest package into the immutable runtime.
2. Re-run the host patch repair.
3. Link the runtime package into the generated Web profile and add it to
   `dsh.profile.bundles`.
4. Verify the installed package still declares `dsh.bundle` and a compatible
   current DSH release.

`pnpm add` into the runtime can replace the already-patched
`@deepseek-ai/dsh-plugin-manager`. Always run:

```text
node /opt/dsh/patches/dsh/patch-host.mjs --repair /opt/dsh/runtime
```

immediately after the runtime install. Repair skips files that still contain the
expected patch markers and patches only the replaced files. Never weaken the
exact upstream hash check to make repair pass.

The profile dependency must be:

```text
dsh-context -> link:/opt/dsh/runtime/node_modules/dsh-context
```

This keeps state migration able to restore the link without running pnpm or
copying a registry tree.

## Caveman skill

- Fetch `skills/caveman/SKILL.md` from upstream `main`.
- Fetch and retain its `LICENSE` and `NOTICE`.
- Validate the frontmatter name before accepting the file.
- It is a skill only; do not install the full Caveman CLI, hooks or companion
  binaries.

## RTK

- Use the **`rtk-oss-*` Apache-2.0 release asset**. Do not use the normal
  `rtk-*` asset: it links the BUSL-1.1 compression engine.
- Upstream permits free production use of the full edition, engine included.
  The reason to choose OSS is redistribution/license hygiene, not runtime cost.
- The OSS edition keeps the hook core and command filters. It omits
  `rtk pipeline`, PostToolUse compression and delegation tasks. The current
  bundled skill only wraps explicit `rtk <command>` calls, so the engine is not
  required.
- Verify the release checksum, install the binary at `/usr/local/bin/rtk`, and
  retain the upstream LICENSE at `/usr/local/share/rtk/LICENSE`.
- Keep the skill manual. Do not add automatic bash rewriting, hooks, or a
  provider-API proxy.

## Verification checklist

Run locally only:

```text
node scripts/verify.mjs
node --test test/*.test.mjs
```

Then push and wait for GitHub Actions. The image matrix must show:

- Web amd64 and arm64: build, native addon, final-image smoke
- Tavern amd64 and arm64: build, native addon, final-image smoke
- Required `CI checks passed` gate

Do not claim image/test completion from source inspection alone. Do not run a
full local image build unless the user explicitly asks for it.
