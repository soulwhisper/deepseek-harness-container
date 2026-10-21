# Image build

Build context is always the repository root; the Dockerfile lives here so
build-only inputs stay separate from local patches, the SSO plugin and the
deploy examples.

```bash
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

| Target | Result |
| --- | --- |
| `web` | Final Web image: DSH Web + dshmarket + required SSO gate |
| `tavern` | Final Tavern image: pinned source workspace + pruned profile + ecosystem |
| `application` | Shared final-stage base without a selected profile |
| `profile-locks` | Maintainer-only export of `profiles/{web,tavern}/pnpm-lock.yaml` |
| `runtime-build` | Internal stage: patched runtime dependency closure |

The runtime is installed at `/opt/dsh/docker/runtime` so the manifest's
`file:../../plugins/sso` dependency resolves both in this repository and in the
image. `/opt/dsh/runtime` is a symlink to that directory for the stable runtime
contract used by scripts, `PATH` and generated profile links.

Profile locks are generated with pnpm `--lockfile-only`, which records absolute
`link:` specifiers relative to the seed workspace. The build runs
`scripts/normalize-locks.mjs` before exporting locks; committed locks are
checked by `scripts/verify.mjs`. Runtime state materialization normalizes the
copied lock again, so a market plugin install cannot rewrite immutable links
against the wrong home directory.

Do not add `latest`, publish ports, or bake credentials, UIDs or edge keys into
build arguments or labels.
