# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Independent Tavern release recipe. It intentionally shares no stage with
# web.Dockerfile: Tavern stays on its pinned DSH/Tavern/theme/plugin graph.
ARG NODE_IMAGE=node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea
FROM ${NODE_IMAGE} AS tools
ENV PNPM_HOME=/usr/local/share/pnpm \
    PATH=/opt/dsh/runtime/node_modules/.bin:/usr/local/share/pnpm:$PATH \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash bubblewrap build-essential ca-certificates curl fd-find git jq less \
      libatomic1 openssh-client procps python3 ripgrep tini unzip \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.25.0 \
    && mkdir -p /opt/dsh /opt/dsh/seed /data/dsh /data/home \
       /cache /logs /backups /workspace \
    && chown -R 1000:1000 /data /cache /logs /backups /workspace

# Tavern-only audit/source payload. Web skills, RTK and floating Web assets are
# absent by construction.
FROM scratch AS distribution-source
COPY docker/tavern.Dockerfile /docker/tavern.Dockerfile
COPY docker/runtime/tavern /docker/runtime/tavern
COPY docker/profiles/tavern /docker/profiles/tavern
COPY docker/profiles/distribution.patch.yml /docker/profiles/distribution.patch.yml
COPY patches/dsh /patches/dsh
COPY patches/tavern /patches/tavern
COPY patches/wrongbook /patches/wrongbook
COPY plugins/forward-auth /plugins/forward-auth
COPY --chmod=0755 scripts/entrypoint.sh /scripts/entrypoint.sh
COPY scripts/materialize-state.mjs scripts/normalize-locks.mjs \
     scripts/materialize-profiles.mjs scripts/floating-bundles.mjs \
     scripts/readiness.mjs scripts/finalize-profile.mjs scripts/link-tavern-core.mjs \
     scripts/seed-tavern-plugins.mjs scripts/seed-tavern-tools.mjs /scripts/
COPY versions.json package.json pnpm-lock.yaml LICENSE NOTICE README.md README.zh-CN.md /
COPY docs/source-build.md docs/regulations.md /docs/

FROM tools AS runtime-build
ARG TARGETARCH
WORKDIR /opt/dsh/docker/runtime
COPY docker/runtime/tavern/package.json docker/runtime/tavern/pnpm-workspace.yaml docker/runtime/tavern/pnpm-lock.yaml ./
COPY plugins/forward-auth /opt/dsh/plugins/forward-auth
COPY patches/dsh /opt/dsh/patches/dsh
RUN pnpm install --frozen-lockfile --prod \
    && rm -rf /opt/dsh/docker/runtime/node_modules/@soulwhisper/dsh-forward-auth \
    && mkdir -p /opt/dsh/docker/runtime/node_modules/@soulwhisper/dsh-forward-auth \
    && cp -a /opt/dsh/plugins/forward-auth/. /opt/dsh/docker/runtime/node_modules/@soulwhisper/dsh-forward-auth/ \
    && grep -q "session-log-deepseek" /opt/dsh/docker/runtime/node_modules/@soulwhisper/dsh-forward-auth/cordis.patch.yml \
    && grep -q "message-feedback" /opt/dsh/docker/runtime/node_modules/@soulwhisper/dsh-forward-auth/cordis.patch.yml \
    && node /opt/dsh/patches/dsh/patch-host.mjs /opt/dsh/docker/runtime \
    && ln -s /opt/dsh/docker/runtime /opt/dsh/runtime
RUN node -e "const {createRequire}=require('node:module'); const r=createRequire('/opt/dsh/docker/runtime/package.json'); const name='node-addon-require-builtin-linux-'+(process.arch==='arm64'?'arm64':'x64')+'-gnu'; require(r.resolve(name));"
COPY versions.json /opt/dsh/versions.json
COPY scripts/entrypoint.sh scripts/materialize-state.mjs scripts/normalize-locks.mjs \
     scripts/materialize-profiles.mjs scripts/floating-bundles.mjs scripts/readiness.mjs \
     scripts/finalize-profile.mjs scripts/link-tavern-core.mjs scripts/seed-tavern-plugins.mjs \
     scripts/seed-tavern-tools.mjs /opt/dsh/scripts/
RUN chmod 0755 /opt/dsh/scripts/entrypoint.sh
COPY docker/profiles/tavern/pnpm-workspace.yaml /opt/dsh/profiles/tavern/pnpm-workspace.yaml
COPY docker/profiles/distribution.patch.yml /opt/dsh/profiles/distribution.patch.yml

FROM runtime-build AS tavern-source
COPY patches/tavern /opt/dsh/patches/tavern
COPY patches/wrongbook /opt/dsh/patches/wrongbook
WORKDIR /opt/apps/dsh-tavern
RUN git init . \
    && git remote add origin https://github.com/flizzywine/dsh-tavern.git \
    && git fetch --depth=1 origin 5deb1ef377240d0f41808a8e346040ff1def31d1 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 5deb1ef377240d0f41808a8e346040ff1def31d1 \
    && rm -rf .git \
    && node /opt/dsh/patches/tavern/patch-tavern.mjs \
    && TAVERN_APP=/opt/apps/dsh-tavern node /opt/dsh/patches/wrongbook/patch-all.mjs \
         --apply --strict --no-backup

# Maintainer-only lock generation for the Tavern profile. The Web profile has
# no committed lock by design and is not generated here.
FROM tavern-source AS profile-lock-builder
RUN DSH_BUILD_PROFILE=tavern node /opt/dsh/scripts/materialize-profiles.mjs \
    && pnpm --dir /opt/dsh/seed/profiles/tavern install --lockfile-only --ignore-scripts \
    && node /opt/dsh/scripts/normalize-locks.mjs \
         /opt/dsh/seed/profiles/tavern/pnpm-lock.yaml
FROM scratch AS profile-locks
COPY --from=profile-lock-builder /opt/dsh/seed/profiles/tavern/pnpm-lock.yaml /profiles/tavern/pnpm-lock.yaml

FROM tavern-source AS tavern-build
RUN mkdir -p /opt/dsh/seed/tavern-tools \
    && cp -a /opt/dsh/patches/wrongbook /opt/dsh/seed/tavern-tools/mvu-api-test
RUN pnpm install --frozen-lockfile --prod=false \
    && node /opt/dsh/scripts/link-tavern-core.mjs
COPY docker/profiles/tavern/pnpm-lock.yaml /opt/dsh/profiles/tavern/pnpm-lock.yaml
RUN DSH_BUILD_PROFILE=tavern node /opt/dsh/scripts/materialize-profiles.mjs \
    && cp /opt/dsh/profiles/tavern/pnpm-lock.yaml /opt/dsh/seed/profiles/tavern/pnpm-lock.yaml \
    && pnpm --dir /opt/dsh/seed/profiles/tavern install --frozen-lockfile --prod \
    && node /opt/dsh/scripts/finalize-profile.mjs /opt/dsh/seed/profiles/tavern
COPY --from=distribution-source / /opt/dsh/source/distribution
RUN tar --exclude=.git --exclude=node_modules -czf /opt/dsh/source/tavern.tar.gz \
      -C /opt/dsh/source distribution -C /opt/apps dsh-tavern \
    && rm -rf /opt/dsh/source/distribution

FROM tools AS tavern-application
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
COPY --from=distribution-source / /opt/dsh/distribution-source
EXPOSE 3080
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 CMD ["node", "/opt/dsh/scripts/readiness.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/dsh/scripts/entrypoint.sh"]
LABEL org.opencontainers.image.source="https://github.com/soulwhisper/deepseek-harness-container" \
      org.opencontainers.image.vendor="soulwhisper" \
      io.github.soulwhisper.distribution.version="0.2.1-rc.2-r2"

FROM tavern-application AS tavern
ARG IMAGE_REVISION
ENV DSH_PROFILE=tavern \
    DSH_SOURCE_ARCHIVE=/opt/dsh/source/tavern.tar.gz \
    DSH_SOURCE_URL=https://github.com/soulwhisper/deepseek-harness-container/tree/${IMAGE_REVISION}
COPY --from=tavern-build /opt/dsh /opt/dsh
COPY --from=tavern-build /opt/apps/dsh-tavern /opt/apps/dsh-tavern
RUN test "${#IMAGE_REVISION}" -eq 40 && test -z "$(printf '%s' "$IMAGE_REVISION" | tr -d '0-9a-f')"
LABEL org.opencontainers.image.title="DeepSeek Harness Tavern with forward-auth" \
      org.opencontainers.image.version="3.1.3" \
      org.opencontainers.image.licenses="Apache-2.0 AND MIT AND AGPL-3.0-only" \
      io.github.soulwhisper.dsh-tavern.commit="5deb1ef377240d0f41808a8e346040ff1def31d1"
