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
    && mkdir -p /opt/dsh /opt/dsh-seed /data/dsh /data/home /data/cache /workspace \
    && chown -R 1000:1000 /data /workspace

FROM tools AS runtime-build
# The runtime manifest's file: dependency is ../../plugins/sso. Keep that
# relative layout in the image and expose the stable /opt/dsh/runtime alias
# used by runtime scripts, PATH and generated profile links.
WORKDIR /opt/dsh/docker/runtime
COPY docker/runtime/package.json docker/runtime/pnpm-workspace.yaml docker/runtime/pnpm-lock.yaml ./
COPY plugins/sso /opt/dsh/plugins/sso
COPY patches/dsh /opt/dsh/patches/dsh
RUN pnpm install --frozen-lockfile --prod \
    && node /opt/dsh/patches/dsh/patch-host.mjs /opt/dsh/docker/runtime \
    && ln -s docker/runtime /opt/dsh/runtime
COPY versions.json /opt/dsh/versions.json
COPY scripts/entrypoint.sh scripts/materialize-state.mjs scripts/normalize-locks.mjs scripts/materialize-profiles.mjs scripts/readiness.mjs scripts/finalize-profile.mjs scripts/link-tavern-core.mjs /opt/dsh/scripts/
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
RUN DSH_BUILD_PROFILE=web node /opt/dsh/scripts/materialize-profiles.mjs \
    && cp /opt/dsh/profiles/web/pnpm-lock.yaml /opt/dsh-seed/profiles/web/pnpm-lock.yaml \
    && pnpm --dir /opt/dsh-seed/profiles/web install --frozen-lockfile --prod \
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
COPY . /opt/dsh-source/distribution
RUN tar --exclude=.git --exclude=node_modules -czf /opt/dsh-source/tavern.tar.gz \
      -C /opt/dsh-source distribution -C /opt/dsh-tavern/apps dsh-tavern \
    && rm -rf /opt/dsh-source/distribution

FROM tools AS application
ENV DSH_HOME=/data/dsh \
    HOME=/data/home \
    XDG_CACHE_HOME=/data/cache \
    XDG_CONFIG_HOME=/data/home/.config \
    XDG_DATA_HOME=/data/home/.local/share \
    npm_config_cache=/data/cache/npm \
    PNPM_HOME=/data/home/.local/share/pnpm \
    DSH_PORT=3080 \
    TMPDIR=/tmp
WORKDIR /workspace
# Keep our complete build/patch inputs alongside the Tavern corresponding source.
COPY . /opt/dsh/distribution-source
RUN chmod 0755 /opt/dsh/distribution-source/scripts/entrypoint.sh
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
LABEL org.opencontainers.image.title="DeepSeek Harness Web with dshmarket and SSO" \
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
LABEL org.opencontainers.image.title="DeepSeek Harness Tavern with SSO" \
      org.opencontainers.image.version="3.0" \
      org.opencontainers.image.licenses="Apache-2.0 AND MIT AND AGPL-3.0-only" \
      io.github.soulwhisper.dsh-tavern.commit="7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d"
