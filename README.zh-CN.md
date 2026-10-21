# DeepSeek Harness Container

[English](README.md) | 简体中文

面向 **Authentik 已验证入口之后的单一共享 owner**，自行打包的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 社区发行版。提供两个 OCI 镜像、自有 SSO 插件、持久化状态，不包含桌面栈。

> DSH `0.2.1-rc.2` 仍是 developer preview，不是经过安全审计的生产平台。登录成功不代表代理、插件、模型凭据或 Agent 沙箱已安全。不要直接暴露应用监听端口。

## 镜像与范围

| 镜像 | Release 标签 | 内置 Profile | 用途 |
| --- | --- | --- | --- |
| `ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2` | `web-0.2.1-rc.2` | 官方 Web + `dshmarket` + `@soulwhisper/dsh-sso` | 通用 DSH Web、用户自行安装的社区插件 |
| `ghcr.io/soulwhisper/dsh-tavern:3.0` | `tavern-3.0` | 自定义 Tavern workspace 构建 + SSO + 配套插件 | 独立 Tavern 实例 |

两个镜像分别跟随自己的上游版本：Web 跟随 DSH，Tavern 跟随 dsh-tavern。Tavern 上游 `v3.0` 在发布时去掉 `v`，写成 `3.0`，与 Web 标签风格一致。两者独立发版；Tavern 上游变化不要求也不阻塞 Web 发布，反之亦然。

两者使用 Node 24/glibc、UID/GID `1000:1000`、`tini`、DSH 原生 `3080` 监听，以及只读根文件系统。**没有 Chromium、GUI、X11、VNC、浏览器桌面、TCP 中继、OIDC 客户端、本地用户名/密码库或替代 mux 服务。** 保留工具链与 pnpm，用于用户显式批准的社区插件操作；启动时不安装依赖。

CI 在原生 GitHub runner（`ubuntu-24.04` 与 `ubuntu-24.04-arm`）上构建 **`linux/amd64` 与 `linux/arm64`**，并在两者上运行完整 Chromium/浏览器 smoke。不使用 QEMU 或跨架构模拟。因此 Apple Silicon 可以原生运行 arm64 镜像；这是 Linux 容器镜像，不是 macOS 宿主应用。部署前查看目标提交的实际 CI 结果，本文不是未执行构建的通过证明。文档组织参考了 [runzhliu/deepseek-harness-docker](https://github.com/runzhliu/deepseek-harness-docker) 等社区项目，但这是不同发行版和不同信任模型，不是其桌面镜像。

## 仓库布局

| 路径 | 内容 | 漂移边界 |
| --- | --- | --- |
| [`patches/`](patches/) | `dsh/` 精确哈希 Host/manager/app-boot 补丁、`market/` 托管运行时桥接、`tavern/` 路由与主题补丁 | 上游变化时单独移植；哈希或锚点不符即拒绝 |
| [`plugins/sso/`](plugins/sso/) | `@soulwhisper/dsh-sso`、其 Cordis 行与许可声明 | 独立维护的自有代码 |
| [`docker/`](docker/) | `Dockerfile`、`runtime/` 依赖闭包、`profiles/` recipe 与已提交锁文件 | 仅镜像构建；上游固定版本在 `versions.json` |
| [`scripts/`](scripts/)、[`test/`](test/)、[`docs/`](docs/) | 构建/维护脚本、回归测试、smoke 工具与交接文档 | 不作为独立运行时发布 |
| [`deploy/`](deploy/) | Docker Compose 与 Kubernetes 示例 | 仅示例；已验证入口与 IdP 仍在外部 |

使用 `-f docker/Dockerfile` 构建，BuildKit context 仍是仓库根目录。把补丁、SSO 插件、镜像构建和示例拆成独立目录后，某个上游破裂只影响局部，不必整体 rebase。

## 自动化与审查

- **仅通过 PR。** `main` 已保护：禁止直接 push、禁止 force push、线性历史、必须通过 `CI checks passed` 且分支最新；CODEOWNERS 负责把安全敏感路径路由给审查者。`ci.yaml` 在 PR 与 merge group 上于原生 amd64/arm64 runner 构建每个目标并运行完整浏览器 smoke；同仓库 PR 的标签由独立的 `labeler.yaml` 处理。公开/fork PR 提交刻意不支持，其 job 会被跳过。
- **发布路径。** 只有 `web-<dsh-version>` 与 `tavern-<version>` 标签会发布。标签须与 `versions.json` 一致且位于 `main`；每个标签在原生 amd64+arm64 runner 上只构建对应目标并分别 smoke，然后把已测试 manifest 合并为版本 index。分支 push 永不发布，也不再生成 candidate `sha-` 镜像。
- **定时清理。** `schedule-cleanup.yaml` 清理取消/跳过及过旧运行；`label-sync.yaml` 恢复受审阅的标签集合。两者都使用 GitHub App token。
- **直接 field test。** `field-test.yaml` 在 Release 标签与手动触发时、不依赖 Docker：在原生 amd64/arm64 runner 安装生产 runtime 闭包，应用精确哈希 host/market 补丁，并验证打补丁后的 host/manager/app-boot/market 与原生 PTY。它是最终镜像 smoke 的补充，不是替代。
- **Renovate 仅供提示。** Renovate runner 与主配置位于 [`soulwhisper/renovate-config`](https://github.com/soulwhisper/renovate-config)；本仓库只在 [`renovate.json`](renovate.json) 中引用 [`.renovate/`](.renovate/) 下的覆盖配置。它跟踪 DSH npm 上游、Tavern GitHub tag、`dshmarket`、根/dev 依赖和 SHA 固定的 Actions；从不自动合并，每个 PR 都带 `review/required`。DSH 仍是 developer preview，即使 patch/digest 更新也必须人工检查并修复。
- **耦合 pin 必须手动。** Node digest、pnpm、源码 commit、精确补丁哈希、Tavern 配套插件和 Profile 锁文件不会自动漂移。Renovate 只改版本号的 PR 预期会验证失败，直到人工补上 commit/hash/lock/release tag。
- **CodeRabbit 仅提供建议。** 需在本仓库安装 CodeRabbit GitHub App。它对非 Renovate PR 运行 actionlint、zizmor、shellcheck、yamllint、gitleaks，不批准、不合并。GitHub App 的 `APP_CLIENT_ID`/`APP_PRIVATE_KEY` 需要 Actions write（清理）、Contents write（Release）、Packages write（GHCR）、Issues write（label sync）和 Pull requests write（独立 labeler）。所有写 token 都由 GitHub App 生成；默认 bot token 只用于只读 checkout。
- **Renovate 启用条件。** 共享 Renovate runner 按 topic 选择仓库，因此本仓库带有 `managed-by-renovate`。删除该 topic 或 App 安装后，更新会静默停止；仅保留 `renovate.json` 不够。
- **唯一自动化身份。** 所有仓库写入都由同一个 GitHub App installation token 生成：labeler、label sync、cleanup、GHCR 发布和 Release 元数据。workflow 不用 `github.token` 写入，不以 `github-actions[bot]` 身份提交 commit；共享 Renovate runner 也使用同一个 App。默认 token 仅用于只读 checkout。

| Workflow | 触发 | 仓库写入 |
| --- | --- | --- |
| `ci.yaml` | PR `opened/synchronize/reopened/ready_for_review`、merge group、手动 | 无 |
| `field-test.yaml` | 标签创建、匹配的 PR 路径、手动 | 无 |
| `labeler.yaml` | 仅同仓库、目标为 `main` 的 PR | App：pull requests |
| `publish.yaml` | `web-*`/`tavern-*` 标签创建 | App：contents + packages |
| `label-sync.yaml` | 定时、`main` 标签文件变化、手动 | App：issues |
| `schedule-cleanup.yaml` | 定时、手动；串行执行 | App：actions |
| `profile-locks.yaml` | 仅手动 | 仅 artifact 上传 |

feature 分支 push 不触发 CI 或发布；合并不会重跑 PR 验证；只有匹配标签创建时才运行 release。

## 固定基线

以 [`versions.json`](versions.json)、已提交的依赖锁文件和 [`docker/Dockerfile`](docker/Dockerfile) 为准。

| 组件 | 固定版本 |
| --- | --- |
| Web 镜像 / Release 标签 | `dsh-web:0.2.1-rc.2` / `web-0.2.1-rc.2` |
| Tavern 镜像 / Release 标签 | `dsh-tavern:3.0` / `tavern-3.0` |
| 本发行版 | `0.2.1-rc.2-r1` |
| 官方 DSH | `0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317` |
| Node / pnpm | `24.22.0` / `11.25.0` |
| DSH Market | `1.66.44` |
| Tavern | `v3.0`，提交 `7f7372c2f2874fd8058e4bdbc16fc55eef4d5d4d` |
| Wrongbook / 图像 / Knock Knock | `v1.33.0` / `v2.9.0` / `v0.7.1` |
| Narrative Anchor | `2ee3da047e5fd6056aef361744655be99b4f7713` |

Tavern 先安装源码 workspace，再生成裁剪后的 Profile；绝对链接稳定指向 `/opt/dsh-tavern/apps/dsh-tavern`。仅对 Tavern 核心执行 `dsh plugin add` **不等于**这套构建。图像插件的包名是 `dsh-tavern-comfy`，源码来自 `dsh-tavern-image`。

## 前置条件与 SSO 信任边界

需要 amd64 Linux Docker 主机、Buildx、UID/GID 1000 可写的存储，以及正确配置的 Authentik forward-auth/已验证入口。OAuth/OIDC、登录、MFA、会话校验和入口授权均由入口负责，**不是此插件实现**。

```text
浏览器 -- HTTPS + IdP 会话 --> 已验证入口
      -- 保留 Host/Origin + 唯一 x-authentik-uid --> DSH 原生监听
                                             --> 同一 DSH owner
```

入口必须：

1. 对**每个 HTTP 请求和 WebSocket upgrade**认证，包括静态资源。
2. 删除客户端提交的全部 `x-authentik-*` 头，再从验证结果设置唯一的 `x-authentik-uid`。使用 **Authentik 稳定 UID**，不是用户名、邮箱或显示名称。
3. 保留公开 `Host` 和浏览器 `Origin`，正常传递 WebSocket upgrade，不解析 mux 帧。
4. 成为唯一可访问 DSH 的网络 peer。除插件 CIDR 校验外，还应使用私网、防火墙或平台等效网络限制。不要信任任意 forwarded-IP 头，也不要把整个共享集群网段当作可信入口。

强制 raw pre-dispatch guard 在每个 HTTP/upgrade 上检查真实 socket peer 和 UID allowlist。缺失、重复、未知 UID 或不可信来源都被拒绝；静态资源与源码下载也受保护。SSO 缺失、卸载或失败时，应用路由保持不可用，不恢复无保护监听。官方宿主补丁经过精确哈希校验，上游改变后必须显式移植。

可信的干净首页请求通过 DSH 原生 Connection API，在**进程内部**完成授权交换。浏览器获得原生 `HttpOnly; SameSite=Strict` Cookie，不发布静态 token 或带启动 token 的 URL。**只有 Cookie 仍不能绕过入口与 UID 检查。** 原生 Host/Origin 检查保持生效。

`DSH_SSO_MAX_CONNECTION_SECONDS` 限制已接受 upgrade 的寿命（默认 900 秒），到期后必须经过入口重连。这不等于 IdP 注销可瞬间撤销已有长连接。所有获准 UID 共享会话、文件、工具、模型和凭据，是**同一个 DSH owner**；不是多用户或租户隔离。不互信的用户必须拆分实例和卷。此插件不保留 `dsh-ui-auth` 的本地账号、邀请注册、按用户 ownership、私有 Key 信封和分享页面。

## 快速部署

先发布或本地构建所需镜像。标签跟随各镜像的上游版本，不表示首次 Release 已经发布。

```bash
# 在依赖锁文件齐全的干净检出目录执行：
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

部署优先使用可信 CI 成功后输出的不可变 `@sha256:…`。本项目刻意不发布 `latest`。不要把凭据、UID 或代理私钥写入构建参数。

### 对接已有已验证入口的 Docker 示例

这只是应用侧示例，**不是完整 Authentik 安装配置**。选择没有冲突的私网段，让真实入口以 `172.30.80.2` 加入该网络、落实上述认证要求，再转发到 `172.30.80.3:3080`。替换示例域名和稳定 UID。应用不向主机发布任何端口。

```bash
docker network create --subnet 172.30.80.0/24 dsh-private
docker volume create dsh-web-data
docker volume create dsh-web-workspace

# 正式部署请改为已核对的不可变 digest；本地也可使用 dsh-web:local。
export IMAGE=ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2
export ALLOWED_UIDS='your-stable-authentik-uid'

docker run --detach --name dsh-web --restart unless-stopped \
  --network dsh-private --ip 172.30.80.3 \
  --user 1000:1000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 512 \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --mount type=volume,src=dsh-web-data,dst=/data \
  --mount type=volume,src=dsh-web-workspace,dst=/workspace \
  --env DSH_HOST=172.30.80.3 --env DSH_PUBLIC_URL=https://dsh.example.net \
  --env DSH_TRUSTED_HOSTS=dsh.example.net \
  --env DSH_SSO_ALLOWED_UIDS="$ALLOWED_UIDS" \
  --env DSH_SSO_TRUSTED_PROXY_CIDRS=172.30.80.2/32 \
  "$IMAGE"
```

Compose 与 Kubernetes 示例见 [`deploy/docker`](deploy/docker) 和 [`deploy/kubernetes`](deploy/kubernetes)。它们只是应用侧示例，不是已验证入口；生产环境应固定审阅过的 digest，而不是版本标签。

访问**干净的 HTTPS 入口地址**，不要从日志取启动 token URL。Tavern 应使用另一容器、独立 `/data` 和 `/workspace` 卷，以及不同监听 IP；不要让两个镜像共用同一活动 DSH home。在编排平台中，让 `DSH_HOST` 等于实际 Pod/容器 IP，使用单个有状态副本；Service VIP 和通配地址都不是原生监听地址。

### 环境变量

| 变量 | 含义 |
| --- | --- |
| `DSH_HOST` | 必填，实际本地监听 IP，不能是 `0.0.0.0`/`::` |
| `DSH_PORT` | 原生监听端口，默认 `3080` |
| `DSH_PUBLIC_URL` | 广告用的干净公开 URL；不配置授权或 TLS |
| `DSH_TRUSTED_HOSTS` | 逗号/空格分隔的公开 authority，转换为重复原生 trusted-host 参数 |
| `DSH_SSO_ALLOWED_UIDS` | **必填**，逗号分隔的稳定 UID allowlist |
| `DSH_SSO_TRUSTED_PROXY_CIDRS` | **必填**，真实 peer 的明确 CIDR allowlist，优先 `/32` 或 `/128` |
| `DSH_SSO_MAX_CONNECTION_SECONDS` | 已接受 upgrade 的最长寿命，默认 `900` |
| `DSH_TLS_CERT`、`DSH_TLS_KEY` | 成对设置的只读原生 TLS 证书/私钥路径 |
| `DSH_STATE_MIGRATION` | 默认 `refuse`；备份后显式用 `apply` 接纳既有/不同版本状态 |
| `DSH_LEGACY_HOME` | 旧 home 来源，默认 `/home/node/.dsh`；迁移只复制，不删除原始数据 |

镜像决定 Profile，`DSH_PROFILE=web` 或 `tavern` 必须与镜像一致。持久布局是 `DSH_HOME=/data/dsh`、`HOME=/data/home`、`XDG_CACHE_HOME=/data/cache`，工作目录为 `/workspace`。不要把不可变 runtime/源码路径改成用户状态目录。

### TLS 与就绪检查

入口到 DSH 的链路需要加密，或需要原生 `Secure` Cookie 时，建议开启原生 TLS。将证书和私钥只读挂载、保证 UID 1000 可读，同时设置**两个** TLS 变量，并让入口校验后端证书和 hostname。即便后端按 IP 访问，也保留公开 Host/Origin。证书更新需要重启；缺失或损坏证书应启动失败，而不是降级 HTTP。

仅设置 `DSH_PUBLIC_URL=https://…` **不会**开启原生 TLS，也不会使原生 Cookie 带 Secure。监听从 HTTP 切到 HTTPS 会改变原生 Cookie 身份，需要重新认证；不要用全局 Cookie 改写或删除 Origin 掩盖问题。

就绪检查只在本地进行：

```bash
docker exec dsh-web node /opt/dsh/scripts/readiness.mjs
```

它连接 `/tmp/dsh-sso-ready.sock`，只有原生启动审计成功且强制 gate 仍活跃时才收到 `ready\n`。没有匿名公开 health 路由。就绪证明已通过审计且受保护的进程正在服务，不证明 IdP、模型服务或沙箱可用。

## 持久化、迁移、备份与回滚

| 路径 | 策略 |
| --- | --- |
| `/data/dsh` | 持久 Profile、设置、凭据、会话与存储；按秘密数据备份 |
| `/data/home` | 持久 shell/工具 home 与插件管理器状态 |
| `/data/cache` | 可写缓存，可重建，不跨不相关 owner 共享 |
| `/workspace` | 持久项目文件，与 DSH 状态一致性快照 |
| `/tmp` | 每容器 scratch/tmpfs，不是备份位置 |
| `/opt/dsh/runtime`、`/opt/dsh-seed`、`/opt/dsh-tavern` | 不可变镜像内容，不是可移植数据卷 |

空状态只 seed 一次。已有但版本/Profile 不同、或布局未识别的状态，默认拒绝，必须显式指定 `DSH_STATE_MIGRATION=apply`。迁移更新托管依赖/链接，移除过时的 `dsh-ui-auth` 激活，保留无关状态，并在 `/data/dsh-migrations` 下创建本地回滚副本。该副本**不是**独立备份，也不是原子文件系统快照。

迁移前停止旧实例，同时快照/导出 **`/data` 和 `/workspace`**，记录旧镜像 digest 及代理/TLS 配置，并在另一位置验证可恢复性。旧 `/home/node/.dsh` 布局可将旧备份只读挂到原路径，或通过 `DSH_LEGACY_HOME` 指定；另挂新可写 `/data`，只显式迁移一次，保留原始数据不动。已有用户依赖需要兼容且已提交的 Profile 锁文件；pnpm 格式不兼容时离线迁移，不要删除锁文件强行绕过。

凭据必须保持仅 owner 可读，不能组可读；不要把整个凭据卷递归 chmod 成 `0777`，也不要跨架构、libc 或绝对路径布局复制原生 `node_modules`。旧 `dsh-ui-auth` 私有模型 Key 由旧本地密码加密：退役旧实例前应明确导出或重新录入，SSO 登录不能解密它们。

回滚时停止新实例，把**升级前**状态与工作区快照恢复到独立卷，恢复旧代理/TLS 配置，再运行旧的固定 digest。不要仅换回旧镜像却让它直接读取已迁移的数据。一个 home 不可有两个 writer。备份含凭据与个人对话，应加密并限制访问；不要将原始日志、凭据或备份归档上传到 Issue。

## 插件更新与发行版更新分工

- **发行版托管**的 DSH、SSO、guard 补丁与内置基线包，通过审阅源码/锁文件并重建镜像更新。原生管理器不得禁用/删除必要 SSO，也不得替换受保护的镜像依赖。
- **Web 用户新增插件**走原生插件管理器及真实安装脚本审批，pnpm 在可写 Profile 中运行。市场不是另一条高权限安装通道。安装插件相当于让代码接触 owner 的文件与凭据，不是购买隔离的市场商品。
- **Tavern 核心**需要固定 workspace 构建，源码提交、补丁、Profile 锁与镜像应一起更新；运行时 `plugin add` 不是支持的捷径。变更配套插件前先备份角色卡和剧情数据。

修改镜像标签不等于批准状态迁移、更新社区插件或证明兼容性。启动时不要自动安装/更新依赖，也不要把 pnpm 降到 10 来“读懂”锁文件。

## 构建、Smoke 与发布

本地 smoke 需要 Node 24、pnpm 11.25.0、Docker/Buildx，以及**宿主侧** Playwright Chromium。浏览器只用于测试，不进入运行时镜像。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install --with-deps chromium
node scripts/verify.mjs
node --test test/*.test.mjs
node scripts/smoke.mjs dsh-web:local dsh-tavern:local
```

Smoke 使用最终只读、非 root 镜像，隔离 scratch/home，并使用可丢弃持久状态。在隔离 Docker 网络内运行真实应用、不可信客户端及模拟已验证入口，检查匿名/伪造/重复 UID 拒绝、Host/Origin、干净 URL/原生 Cookie、**Chromium 真实执行客户端 JS**、原生 `$events` ready、连接寿命、真实 PTY、Profile 导入与 Tavern 受保护源码下载。模拟入口删除浏览器伪造头，再注入合成测试 UID。它**不等于真实 Authentik 登录/MFA/注销验证**，也不调用真实模型；这些需要在实际部署中另行验收。输出仅含检查摘要，不打印启动 URL、Cookie、凭据、响应体或原始启动日志；失败诊断应私下处理。

### 首次 Profile 锁文件引导

如果新 recipe 尚无已提交的 `docker/profiles/{web,tavern}/pnpm-lock.yaml`，由维护者手动触发 **Bootstrap missing profile locks** 工作流；它只构建 `profile-locks` 导出目标，并上传名为 `profile-locks` 的 artifact。下载、审阅后把 web/Tavern 锁分别放进 `docker/profiles/web`、`docker/profiles/tavern` 并提交。生成的锁使用绝对 `link:/opt/dsh/runtime/...` 版本；`scripts/normalize-locks.mjs` 会修正它们，CI 拒绝相对 link 版本。最终 CI/发布在两份锁提交前故意失败。这是显式引导，不是在最终构建时偷偷重新解析依赖。

### 发布策略

- PR 运行源码检查、测试、原生 amd64+arm64 构建，并在两者上运行完整最终镜像 smoke；不获取仓库/App secrets、不使用 `pull_request_target`、不写 package、不自动合并。
- Release 标签须与 `versions.json.release.<target>.tag` 精确一致且位于 `main`。标签 job 在原生 amd64/arm64 runner 上只构建对应目标、分别 smoke，推送两个 staging manifest，再合并为一个版本 index。两条发布路径彼此独立；没有浮动 `latest`，也不从分支发布。
- GHCR 发布与 GitHub Release 元数据都使用 GitHub App installation token（Contents + Packages write）。App 是唯一写身份；默认 `GITHUB_TOKEN` 只用于只读 checkout。首次发布可创建新 package。秘密不进入构建参数或镜像层。
- index 引用两个已测试的架构 manifest；当前不附加 BuildKit provenance 或 SBOM attestation。部署请按 digest 固定。

部署固定 digest，同时保存上一 digest 和卷快照。支持范围是明确固定并测试的发行版，不是任意上游 RC 或插件组合。上游/SSO 更新必须重新审阅、必要时移植精确哈希补丁、更新锁并运行完整 smoke；不承诺 LTS 或已安全审计。报告问题请附镜像 digest、架构、脱敏配置与检查摘要，不能附秘密。

## 沙箱注意事项

容器限制与 DSH Agent 沙箱保护不同边界。PTY 成功不代表当前宿主内核/容器运行时支持 Landlock 或 bubblewrap。向模型开放工具前，在目标主机执行真实文件/shell 操作，并尝试越出工作区写入。无支持沙箱时应失败，不要用 `--privileged`、Docker socket、宽泛宿主挂载、额外 capabilities、`danger-full-access` 或伪造 runner 掩盖失败。第三方插件是宿主侧代码，不受 Agent workspace policy 隔离。

## 许可与对应源码

本项目原创代码保留现有 [LICENSE](LICENSE) 的 **Apache-2.0**。DSH、市场及 MIT 配套插件版权/许可保存在 [NOTICE](NOTICE) 与安装包中；顶层许可不重新许可整个依赖树。

**Tavern 是 AGPL-3.0-only。** 原始完整许可证和修改后源码位于 `/opt/dsh-tavern/apps/dsh-tavern`；构建/补丁 recipe 在 `/opt/dsh/distribution-source` 和 [`docker/profiles/tavern/SOURCE-BUILD.txt`](docker/profiles/tavern/SOURCE-BUILD.txt)。Tavern UI 提供经认证的 **Tavern source (AGPL-3.0)** 链接，通过 `/distribution/source.tar.gz` 下载 `/opt/dsh-source/tavern.tar.gz`，另有确切发行版源码提交链接。归档包含源码与构建输入，不含用户数据或已安装 `node_modules`。部署时应保持用户可以获取对应源码；修改或再分发 Tavern 时，应履行适用的分发/网络源码义务。
