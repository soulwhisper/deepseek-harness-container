# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Independent Web release recipe. It intentionally shares no stage with
# tavern.Dockerfile: Web follows the alpha line and its plugins while Tavern
# stays pinned to its own DSH/Tavern/theme graph.
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
       /data/memory /cache /logs /backups /workspace \
    && chown -R 1000:1000 /data /cache /logs /backups /workspace

# Web-only audit/source payload.
FROM scratch AS distribution-source
COPY docker/web.Dockerfile /docker/web.Dockerfile
COPY docker/runtime/web /docker/runtime/web
COPY docker/profiles/web /docker/profiles/web
COPY docker/profiles/distribution.patch.yml /docker/profiles/distribution.patch.yml
COPY patches/dsh /patches/dsh
COPY patches/market /patches/market
COPY plugins/forward-auth /plugins/forward-auth
COPY --chmod=0755 scripts/entrypoint.sh /scripts/entrypoint.sh
COPY scripts/materialize-state.mjs scripts/normalize-locks.mjs \
     scripts/materialize-profiles.mjs scripts/floating-bundles.mjs \
     scripts/readiness.mjs scripts/finalize-profile.mjs /scripts/
COPY versions.json package.json pnpm-lock.yaml LICENSE NOTICE README.md README.zh-CN.md /
COPY docs/source-build.md docs/regulations.md /docs/

FROM tools AS runtime-build
ARG TARGETARCH
# Web runtime is deliberately not lock-pinned: the alpha plugin set is
# resolved at image-build time and the published digest is the boundary.
WORKDIR /opt/dsh/docker/runtime
COPY docker/runtime/web/package.json docker/runtime/web/pnpm-workspace.yaml ./
COPY plugins/forward-auth /opt/dsh/plugins/forward-auth
COPY patches/dsh /opt/dsh/patches/dsh
RUN pnpm install --no-frozen-lockfile --prod \
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
     scripts/finalize-profile.mjs /opt/dsh/scripts/
RUN chmod 0755 /opt/dsh/scripts/entrypoint.sh
COPY docker/profiles/web/pnpm-workspace.yaml /opt/dsh/profiles/web/pnpm-workspace.yaml
COPY docker/profiles/web/cordis.patch.yml /opt/dsh/profiles/web/cordis.patch.yml
COPY docker/profiles/web/compatibility.json /opt/dsh/profiles/web/compatibility.json
COPY docker/profiles/distribution.patch.yml /opt/dsh/profiles/distribution.patch.yml

FROM runtime-build AS web-build
ARG TARGETARCH
COPY patches/market /opt/dsh/patches/market
COPY docker/skills/ /opt/dsh/seed/skills/
RUN set -eux; \
    mkdir -p /opt/dsh/seed/skills/caveman /usr/local/share/rtk; \
    caveman_tag="$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/JuliusBrussee/caveman/releases/latest | sed -n 's#.*/tag/##p')"; \
    test -n "$caveman_tag"; \
    caveman_base="https://raw.githubusercontent.com/JuliusBrussee/caveman/${caveman_tag}"; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      "${caveman_base}/skills/caveman/SKILL.md" -o /opt/dsh/seed/skills/caveman/SKILL.md; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      "${caveman_base}/LICENSE" -o /opt/dsh/seed/skills/caveman/LICENSE; \
    curl --fail --show-error --silent --location --retry 3 --retry-delay 2 \
      "${caveman_base}/NOTICE" -o /opt/dsh/seed/skills/caveman/NOTICE; \
    grep -q '^name: caveman$' /opt/dsh/seed/skills/caveman/SKILL.md; \
    printf '%s\n' \
      "Fetched at image build from https://github.com/JuliusBrussee/caveman/releases/tag/${caveman_tag}" \
      "Resolved release: ${caveman_tag}" 'Path: skills/caveman/SKILL.md' \
      'Floating: no commit or version pin is tracked in this repository.' \
      > /opt/dsh/seed/skills/caveman/SOURCE; \
    arch="${TARGETARCH:-x86_64}"; \
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
# Resolve the open Web profile and its owner-installed plugins. There is no
# committed Web profile lock: data is durable, plugin code may update.
RUN DSH_BUILD_PROFILE=web node /opt/dsh/scripts/materialize-profiles.mjs \
    && pnpm --dir /opt/dsh/seed/profiles/web install --no-frozen-lockfile --prod \
    && node /opt/dsh/scripts/finalize-profile.mjs /opt/dsh/seed/profiles/web \
    && node /opt/dsh/patches/market/patch-market.mjs /opt/dsh/runtime/node_modules/dshmarket

# Web-only final base. Tavern has its own Dockerfile and never derives from it.
FROM tools AS web-application
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
      io.github.soulwhisper.distribution.version="0.2.2-alpha.2-r1"

FROM web-application AS web
USER root
RUN npm install --global --ignore-scripts @mnemon-dev/mnemon@0.2.13
USER 1000:1000
ENV DSH_PROFILE=web
COPY --from=web-build /opt/dsh /opt/dsh
COPY docker/skills/ /opt/dsh/distribution-source/docker/skills/
COPY --from=web-build /usr/local/bin/rtk /usr/local/bin/rtk
COPY --from=web-build /usr/local/share/rtk /usr/local/share/rtk
LABEL org.opencontainers.image.title="DeepSeek Harness Web alpha with dshmarket, dsh-context, memory and plugins" \
      org.opencontainers.image.version="0.2.2-alpha.2-r1" \
      org.opencontainers.image.licenses="Apache-2.0 AND MIT"
