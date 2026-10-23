# Wrongbook host patches

This directory vendors the host-patch subset of
`XGUIMAX/dsh-tavern-wrongbook` v1.33.0 `debug/` (MIT; see `NOTICE`).

`dsh-tavern-wrongbook` looks for `<tavern data>/tools/mvu-api-test/patch-all.mjs`
and runs it with `--apply` at startup and from its panel. That model assumes a
writable desktop Tavern checkout. This distribution runs an immutable
`/opt/apps/dsh-tavern`, so the same patches are applied during the image build.
The seeded data copy is used only to report status and must be a no-op at
runtime.

## Included

| File | Upstream | Target |
| --- | --- | --- |
| `patch-mvu-api.mjs` | `debug/patch.mjs` | `lib/domain/tavern-helper-scripts.js` |
| `patch-timeout-body.mjs` | `debug/patch-test.mjs` | `lib/domain/card-response-test.js` |

Both anchors were verified against Tavern `v3.1.3`. The build runs:

```text
TAVERN_APP=/opt/apps/dsh-tavern node patches/wrongbook/patch-all.mjs \
  --apply --strict --no-backup
```

## Deliberately not included

The remaining upstream patches target an older Tavern client/turn tree and do
not match the pinned source:

- `debug/patch-src.mjs` (client helper/frame/workshop patch set)
- `debug/patch-reasoning-notice.mjs`
- `debug/patch-reasoning-fallback.mjs`
- `debug/patch-card-generate.mjs` (user card data, never image content)

`patch-all.mjs` lists them as not applicable so the wrongbook panel does not
pretend to have applied them. Re-porting one means deriving new anchors against
the pinned Tavern source, adding it to `PATCHES`, and adding a behavioral test.

## Runtime

The image seeds this directory to:

```text
$DSH_HOME/profile-data/tavern/data/tools/mvu-api-test/
```

The seed is first-boot only: an existing user-managed copy is never overwritten.
At runtime `--apply` is expected to find every supported patch already applied
and print `没有需要重打的。`; it writes nothing.
