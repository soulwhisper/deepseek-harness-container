# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
ARG NODE_IMAGE=node:24.22.0-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315
FROM ${NODE_IMAGE} AS tools
ENV PNPM_HOME=/usr/local/share/pnpm \
    PATH=/opt/dsh/runtime/node_modules/.bin:/usr/local/share/pnpm:$PATH \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=true
# No desktop, X11, browser, VNC, TCP relay or auxiliary auth server.
# Native plugin builds approved from the Web manager require these toolchains.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash bubblewrap build-essential ca-certificates curl fd-find git jq less \
      libatomic1 openssh-client procps python3 ripgrep tini unzip \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.25.0 \
    && mkdir -p /opt/dsh /opt/dsh-seed /data/dsh /data/home \
       /cache /logs /backups /workspace \
    && chown -R 1000:1000 /data /cache /logs /backups /workspace

# Exact build inputs retained for corresponding-source and audit purposes.
# Test, smoke, CI, deploy and general docs are deliberately not copied into
# either final image; only the source-build and licensing docs belong here.
FROM scratch AS distribution-source
COPY docker /docker
COPY patches /patches
COPY plugins/forward-auth /plugins/forward-auth
COPY --chmod=0755 scripts/entrypoint.sh /scripts/entrypoint.sh
COPY scripts/materialize-state.mjs scripts/normalize-locks.mjs \
     scripts/materialize-profiles.mjs scripts/floating-bundles.mjs \
     scripts/readiness.mjs scripts/finalize-profile.mjs scripts/link-tavern-core.mjs /scripts/
COPY versions.json package.json pnpm-lock.yaml LICENSE NOTICE README.md README.zh-CN.md /
COPY docs/source-build.md docs/regulations.md /docs/

FROM tools AS runtime-build
ARG TARGETARCH
# The runtime manifest's file: dependency is ../../plugins/forward-auth. Keep that
# relative layout in the image and expose the stable /opt/dsh/runtime alias
# used by runtime scripts, PATH and generated profile links.
WORKDIR /opt/dsh/docker/runtime
COPY docker/runtime/package.json docker/runtime/pnpm-workspace.yaml docker/runtime/pnpm-lock.yaml ./
COPY plugins/forward-auth /opt/dsh/plugins/forward-auth
COPY patches/dsh /opt/dsh/patches/dsh
RUN pnpm install --frozen-lockfile --prod \
    && node /opt/dsh/patches/dsh/patch-host.mjs /opt/dsh/docker/runtime \
    && ln -s docker/runtime /opt/dsh/runtime
# Fail the build if native optional packages were resolved for the wrong
# architecture (a stale multi-arch cache can otherwise hide this until boot).
RUN node -e "const {createRequire}=require('node:module'); const r=createRequire('/opt/dsh/docker/runtime/package.json'); const name='node-addon-require-builtin-linux-'+(process.arch==='arm64'?'arm64':'x64')+'-gnu'; require(r.resolve(name));"
COPY versions.json /opt/dsh/versions.json
COPY scripts/entrypoint.sh scripts/materialize-state.mjs scripts/normalize-locks.mjs scripts/materialize-profiles.mjs scripts/floating-bundles.mjs scripts/readiness.mjs scripts/finalize-profile.mjs scripts/link-tavern-core.mjs /opt/dsh/scripts/
RUN chmod 0755 /opt/dsh/scripts/entrypoint.sh
COPY docker/profiles/web/pnpm-workspace.yaml /opt/dsh/profiles/web/pnpm-workspace.yaml
COPY docker/profiles/tavern/pnpm-workspace.yaml /opt/dsh/profiles/tavern/pnpm-workspace.yaml
COPY docker/profiles/distribution.patch.yml /opt/dsh/profiles/distribution.patch.yml
FROM runtime-build AS tavern-source
COPY patches/tavern /opt/dsh/patches/tavern
WORKDIR /opt/dsh-tavern/apps/dsh-tavern
RUN git init . \
    && git remote add origin https://github.com/flizzywine/dsh-tavern.git \
    && git fetch --depth=1 origin 7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d \
    && rm -rf .git \
    && node /opt/dsh/patches/tavern/patch-tavern.mjs

# Maintainer-only lock generation. Export with:
# docker buildx build --target profile-locks --output type=local,dest=. .
# This target intentionally does not depend on the profile locks it generates.
FROM tavern-source AS profile-lock-builder
RUN node /opt/dsh/scripts/materialize-profiles.mjs \
    && pnpm --dir /opt/dsh-seed/profiles/web install --lockfile-only --ignore-scripts \
    && pnpm --dir /opt/dsh-seed/profiles/tavern install --lockfile-only --ignore-scripts \
    && node /opt/dsh/scripts/normalize-locks.mjs \
         /opt/dsh-seed/profiles/web/pnpm-lock.yaml \
         /opt/dsh-seed/profiles/tavern/pnpm-lock.yaml
FROM scratch AS profile-locks
COPY --from=profile-lock-builder /opt/dsh-seed/profiles/web/pnpm-lock.yaml /profiles/web/pnpm-lock.yaml
COPY --from=profile-lock-builder /opt/dsh-seed/profiles/tavern/pnpm-lock.yaml /profiles/tavern/pnpm-lock.yaml

FROM runtime-build AS web-build
COPY docker/profiles/web/pnpm-lock.yaml /opt/dsh/profiles/web/pnpm-lock.yaml
COPY patches/market /opt/dsh/patches/market
# Seed-only Web skills. Tavern intentionally receives neither these skills nor
# the RTK binary; its profile remains the Tavern distribution only.
COPY docker/skills/ /opt/dsh-seed/skills/

# Floating optional Web assets are deliberately resolved from upstream at build
# time, never pinned in versions.json or Renovate. The published image digest,
# not a mutable tag, is the reproducibility boundary. A moved skill path,
# changed frontmatter or missing release asset fails the build instead of
# silently shipping stale content.
RUN set -eux; \
    mkdir -p /opt/dsh-seed/skills/caveman /usr/local/share/rtk; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      https://raw.githubusercontent.com/JuliusBrussee/caveman/main/skills/caveman/SKILL.md \
      -o /opt/dsh-seed/skills/caveman/SKILL.md; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      https://raw.githubusercontent.com/JuliusBrussee/caveman/main/LICENSE \
      -o /opt/dsh-seed/skills/caveman/LICENSE; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      https://raw.githubusercontent.com/JuliusBrussee/caveman/main/NOTICE \
      -o /opt/dsh-seed/skills/caveman/NOTICE; \
    grep -q '^name: caveman$' /opt/dsh-seed/skills/caveman/SKILL.md; \
    printf '%s\n' \
      'Fetched at image build from https://github.com/JuliusBrussee/caveman' \
      'Path: skills/caveman/SKILL.md' \
      'Floating: no commit or version pin is tracked in this repository.' \
      > /opt/dsh-seed/skills/caveman/SOURCE

# Use the Apache-2.0 "oss" edition (rtk-oss-*), never the release asset whose
# compression engine is BUSL-1.1. The target triple follows BuildKit's
# TARGETARCH; the fallback keeps plain docker build usable.
RUN set -eux; \
    arch="${TARGETARCH:-$(uname -m)}"; \
    case "$arch" in \
      amd64|x86_64) rtk_target=x86_64-unknown-linux-musl ;; \
      arm64|aarch64) rtk_target=aarch64-unknown-linux-gnu ;; \
      *) echo "Unsupported RTK architecture: $arch" >&2; exit 1 ;; \
    esac; \
    rtk_tag="$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/rtk-ai/rtk/releases/latest | sed -n 's#.*/tag/##p')"; \
    test -n "$rtk_tag"; \
    rtk_asset="rtk-oss-${rtk_target}.tar.gz"; \
    rtk_dir="$(mktemp -d)"; \
    trap 'rm -rf "$rtk_dir"' EXIT; \
    base="https://github.com/rtk-ai/rtk/releases/download/${rtk_tag}"; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      "${base}/${rtk_asset}" -o "$rtk_dir/$rtk_asset"; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      "${base}/checksums.txt" -o "$rtk_dir/checksums.txt"; \
    expected="$(awk -v asset="$rtk_asset" '$2 == asset { print $1 }' "$rtk_dir/checksums.txt")"; \
    test -n "$expected"; \
    actual="$(sha256sum "$rtk_dir/$rtk_asset" | awk '{ print $1 }')"; \
    test "$expected" = "$actual"; \
    if tar -tzf "$rtk_dir/$rtk_asset" | grep -qE '^/|(^|/)\.\.(/|$)'; then \
      echo 'Unsafe path in RTK archive' >&2; exit 1; \
    fi; \
    tar -xzf "$rtk_dir/$rtk_asset" -C "$rtk_dir"; \
    test -x "$rtk_dir/rtk"; \
    install -m 0755 "$rtk_dir/rtk" /usr/local/bin/rtk; \
    test -f "$rtk_dir/LICENSE"; \
    install -m 0644 "$rtk_dir/LICENSE" /usr/local/share/rtk/LICENSE; \
    printf '%s\n' \
      "Downloaded at image build: ${base}/${rtk_asset}" \
      "Resolved release: ${rtk_tag}" \
      'Edition: rtk-oss (Apache-2.0; no BUSL-1.1 compression engine)' \
      'Floating: no release version is tracked in this repository.' \
      > /usr/local/share/rtk/SOURCE; \
    rtk --version

# dsh-context is a floating optional Web plugin, not a pinned runtime input.
# Install it into the immutable runtime from npm latest, then link it into the
# profile. Keeping it out of the writable profile lets state migration restore
# the link without running pnpm or copying a registry tree.
RUN pnpm --dir /opt/dsh/runtime add dsh-context@latest --prod --ignore-scripts \
      --config.auto-install-peers=false
RUN DSH_BUILD_PROFILE=web node /opt/dsh/scripts/materialize-profiles.mjs \
    && cp /opt/dsh/profiles/web/pnpm-lock.yaml /opt/dsh-seed/profiles/web/pnpm-lock.yaml \
    && node /opt/dsh/scripts/floating-bundles.mjs add web /opt/dsh-seed/profiles/web \
    && pnpm --dir /opt/dsh-seed/profiles/web install --no-frozen-lockfile --prod \
    && DSH_VERSION="$(node -p 'require("/opt/dsh/versions.json").dsh.version')" \
       node /opt/dsh/scripts/floating-bundles.mjs verify web /opt/dsh-seed/profiles/web \
    && node /opt/dsh/scripts/finalize-profile.mjs /opt/dsh-seed/profiles/web \
    && node /opt/dsh/patches/market/patch-market.mjs /opt/dsh/runtime/node_modules/dshmarket

FROM tavern-source AS tavern-build
# This is the working custom recipe, not plugin-add of the core package:
# source workspace install + pruned profile + stable absolute source links.
RUN pnpm install --frozen-lockfile --prod=false \
    && node /opt/dsh/scripts/link-tavern-core.mjs
COPY docker/profiles/tavern/pnpm-lock.yaml /opt/dsh/profiles/tavern/pnpm-lock.yaml
RUN DSH_BUILD_PROFILE=tavern node /opt/dsh/scripts/materialize-profiles.mjs \
    && cp /opt/dsh/profiles/tavern/pnpm-lock.yaml /opt/dsh-seed/profiles/tavern/pnpm-lock.yaml \
    && pnpm --dir /opt/dsh-seed/profiles/tavern install --frozen-lockfile --prod \
    && node /opt/dsh/scripts/finalize-profile.mjs /opt/dsh-seed/profiles/tavern
COPY --from=distribution-source / /opt/dsh-source/distribution
RUN tar --exclude=.git --exclude=node_modules -czf /opt/dsh-source/tavern.tar.gz \
      -C /opt/dsh-source distribution -C /opt/dsh-tavern/apps dsh-tavern \
    && rm -rf /opt/dsh-source/distribution

FROM tools AS application
ENV DSH_HOME=/data/dsh \
    HOME=/data/home \
    DSH_AGENTS_HOME=/data/home/.agents \
    DSH_BACKUP_ROOT=/backups \
    XDG_CACHE_HOME=/cache \
    XDG_CONFIG_HOME=/data/home/.config \
    XDG_DATA_HOME=/data/home/.local/share \
    npm_config_cache=/cache/npm \
    PNPM_HOME=/data/home/.local/share/pnpm \
    NARB_DISABLE_NATIVE_CACHE=1 \
    DSH_PORT=3080 \
    TMPDIR=/tmp
WORKDIR /workspace
# Exact build/patch inputs, not the repository's test and deploy trees.
COPY --from=distribution-source / /opt/dsh/distribution-source
EXPOSE 3080
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 CMD ["node", "/opt/dsh/scripts/readiness.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/dsh/scripts/entrypoint.sh"]
LABEL org.opencontainers.image.source="https://github.com/soulwhisper/deepseek-harness-container" \
      org.opencontainers.image.vendor="soulwhisper" \
      io.github.soulwhisper.distribution.version="0.2.1-rc.2-r1"

FROM application AS web
ENV DSH_PROFILE=web
COPY --from=web-build /opt/dsh /opt/dsh
COPY --from=web-build /opt/dsh-seed /opt/dsh-seed
# RTK and the Caveman skill are Web-only optional assets. Tavern intentionally
# has neither the binary nor the seed skills.
COPY --from=web-build /usr/local/bin/rtk /usr/local/bin/rtk
COPY --from=web-build /usr/local/share/rtk /usr/local/share/rtk
LABEL org.opencontainers.image.title="DeepSeek Harness Web with dshmarket, dsh-context and forward-auth" \
      org.opencontainers.image.version="0.2.1-rc.2" \
      org.opencontainers.image.licenses="Apache-2.0 AND MIT"

FROM application AS tavern
ARG IMAGE_REVISION
ENV DSH_PROFILE=tavern \
    DSH_SOURCE_ARCHIVE=/opt/dsh-source/tavern.tar.gz \
    DSH_SOURCE_URL=https://github.com/soulwhisper/deepseek-harness-container/tree/${IMAGE_REVISION}
COPY --from=tavern-build /opt/dsh /opt/dsh
COPY --from=tavern-build /opt/dsh-seed /opt/dsh-seed
# Full upstream source, lock, patches, client assets and LICENSE are retained.
COPY --from=tavern-build /opt/dsh-tavern /opt/dsh-tavern
COPY --from=tavern-build /opt/dsh-source /opt/dsh-source
RUN test "${#IMAGE_REVISION}" -eq 40 && test -z "$(printf '%s' "$IMAGE_REVISION" | tr -d '0-9a-f')"
LABEL org.opencontainers.image.title="DeepSeek Harness Tavern with forward-auth" \
      org.opencontainers.image.version="3.0" \
      org.opencontainers.image.licenses="Apache-2.0 AND MIT AND AGPL-3.0-only" \
      io.github.soulwhisper.dsh-tavern.commit="7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d"
