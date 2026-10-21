# DeepSeek Harness Container

[English](README.md) | 简体中文

面向 **已验证 forward-auth 入口之后的单一共享 owner**，自行打包的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 发行版。提供两个 OCI 镜像、独立维护的 forward-auth gate、明确的状态/备份边界，不包含桌面栈。

> DSH `0.2.1-rc.2` 仍是 developer preview，不是经过安全审计的生产平台。登录成功不代表入口、插件、模型凭据、备份或 Agent 沙箱已安全。不要直接暴露原生监听端口。

## 镜像

| 镜像 | Release 标签 | Profile |
| --- | --- | --- |
| `ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2` | `web-0.2.1-rc.2` | DSH Web + `dshmarket` + 必需 forward-auth |
| `ghcr.io/soulwhisper/dsh-tavern:3.0` | `tavern-3.0` | 自定义 Tavern workspace + forward-auth + 配套插件 |

Web 跟随 DSH 上游版本，Tavern 跟随 dsh-tavern；两者独立发版。镜像使用 Node 24/glibc、UID/GID `1000:1000`、单一具体 IP 的 `3080` 监听和只读根文件系统。CI 在原生 `linux/amd64` 与 `linux/arm64` runner 上构建，不使用 QEMU。镜像不包含 Chromium、GUI、X11、VNC、本地密码库、OIDC 客户端或替代 mux 服务。

## 文档

| 文档 | 内容 |
| --- | --- |
| [文档首页](docs/index.md) | 阅读路径、镜像与安全摘要 |
| [Architecture](docs/architecture.md) | 镜像、信任边界、仓库布局 |
| [Constraints](docs/constraints.md) | 安全与兼容性约束 |
| [Build](docs/build.md) | Docker target、源码载荷、锁文件 |
| [Deploy](docs/deploy.md) | Compose 与 Kubernetes 示例 |
| [Operations](docs/operations.md) | 启动、迁移、备份、回滚 |
| [Data layout](docs/data-layout.md) | 持久状态与 cache/logs/backup/tmp 边界 |
| [Patches](docs/patches.md) | 精确哈希上游补丁 |
| [Source build](docs/source-build.md) | Tavern 对应源码与重建配方 |
| [Licensing](docs/regulations.md) | Apache/MIT/AGPL 义务 |
| [Forward-auth](docs/forward-auth.md) | trusted-edge 认证、状态日志、token URL |
| [HA plan](docs/ha-plan.md) | replica、PDB、RWX 与 DSH 限制 |

`docs/` 仅维护英文文档；根目录中文 README 是本地化入口，不建立第二套文档树。

## 构建

Build context 是仓库根目录，Dockerfile 为 `docker/Dockerfile`。

```bash
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target web \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-web:local .
docker buildx build -f docker/Dockerfile --platform linux/amd64 --target tavern \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" --load -t dsh-tavern:local .
```

最终镜像只接收白名单构建/源码输入；test、smoke、deploy、CI 和一般文档不会随镜像发布。修改锁、补丁、源码 commit 或 release tag 前请阅读 [build](docs/build.md)。

## 运行

生产环境必须使用核验过的 `@sha256:…` digest，而不是可变 tag。以下为应用侧示例：已验证入口已存在于私网，容器不发布宿主端口。

```bash
docker network create --subnet 172.30.80.0/24 dsh-private
docker volume create dsh-web-data
docker volume create dsh-web-workspace
docker volume create dsh-web-cache
docker volume create dsh-web-logs
docker volume create dsh-web-backups

export IMAGE=ghcr.io/soulwhisper/dsh-web:0.2.1-rc.2
export ALLOWED_SUBJECTS='your-stable-owner-id'

docker run --detach --name dsh-web --restart unless-stopped \
  --network dsh-private --ip 172.30.80.3 \
  --user 1000:1000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 512 \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=256m \
  --mount type=volume,src=dsh-web-data,dst=/data \
  --mount type=volume,src=dsh-web-workspace,dst=/workspace \
  --mount type=volume,src=dsh-web-cache,dst=/cache \
  --mount type=volume,src=dsh-web-logs,dst=/logs \
  --mount type=volume,src=dsh-web-backups,dst=/backups \
  --env DSH_HOST=172.30.80.3 \
  --env DSH_PUBLIC_URL=https://dsh.example.net \
  --env DSH_TRUSTED_HOSTS=dsh.example.net \
  --env DSH_FORWARD_AUTH_HEADER=x-authentik-uid \
  --env DSH_FORWARD_AUTH_ALLOWED_SUBJECTS="$ALLOWED_SUBJECTS" \
  --env DSH_FORWARD_AUTH_TRUSTED_PROXY_CIDRS=172.30.80.2/32 \
  "$IMAGE"
```

访问干净的 HTTPS 入口地址，不要使用启动日志中的 URL。Tavern 应使用独立容器、`/data`、`/workspace`、cache/log/backup 根和监听 IP。Compose/Kubernetes 示例见 [`deploy/`](deploy/)，操作细节见 [deploy](docs/deploy.md)。

## 状态与备份边界

| 路径 | 策略 |
| --- | --- |
| `/data/dsh` | 持久 Profile、sessions、storages、attachments、凭据；加密备份 |
| `/data/home` | 持久 HOME/XDG/工具状态；备份 |
| `/workspace` | 持久用户项目；与 `/data/dsh` 一致快照 |
| `/cache` | 可重建缓存；`$DSH_HOME/cache` 指向这里，可丢 |
| `/logs` | DSH 启动诊断；`$DSH_HOME/logs` 指向这里，敏感且非权威 |
| `/backups` | `DSH_BACKUP_ROOT` 下的迁移回滚副本，不是独立备份 |
| `/tmp` | 每容器 tmpfs scratch，可能 `noexec` |
| `/opt/dsh`、`/opt/dsh-seed`、`/opt/dsh-tavern`、`/opt/dsh-source` | 不可变镜像内容 |

不要把 cache、logs、backup 或 scratch 放回 `/data`；entrypoint 会把旧的 `cache`/`logs` 目录移动一次，并在回滚副本中排除。详见 [data layout](docs/data-layout.md)。

## Forward-auth 边界

OAuth/OIDC、登录、MFA、会话校验和访问策略由已验证入口负责，**不是**镜像内的 OIDC 客户端。入口必须认证每个 HTTP 请求与 WebSocket upgrade，删除客户端提交的身份头，设置唯一、可配置的稳定 subject header，保留公开 Host/Origin，并成为唯一可访问 DSH 的网络 peer。

`@soulwhisper/dsh-forward-auth` 检查真实 peer CIDR 与 subject allowlist，保护静态资源、源码和原生 manager，并通过 DSH Connection API 换取原生 `HttpOnly; SameSite=Strict` cookie。header 可配置（Authentik `x-authentik-uid`、Authelia `Remote-User` 等）；镜像不包含 OIDC client、本地密码、bootstrap admin 或用户面板。认证缺失或失败时路由保持拒绝，不会退回无保护监听。所有允许 subject 共享一个 DSH owner 的文件、工具、模型与凭据，不是多用户隔离。

gate 还会拒绝任何查询字符串包含 `token` 的请求，包括 upstream DSH launch-token URL 和 WebSocket upgrade。启动日志仍可能包含该 token；必须把容器日志视为敏感数据。状态日志会报告 `waiting-for-edge`、`active`、限速的拒绝原因，或固定分类的 `broken`。详见 [forward-auth](docs/forward-auth.md)。

## 发布与自动化

只有 `web-<dsh-version>` 与 `tavern-<version>` 标签会发布。标签必须匹配 `versions.json`、位于 `main`，在原生 amd64/arm64 runner 上构建并 smoke，再合并为一个多架构 index。没有 `latest`、分支发布或 candidate `sha-` 镜像。PR 只运行静态检查、测试和原生镜像 smoke，不获取仓库 secrets。同仓库 PR labeler 与定时 label sync 只使用 job 级默认 token（`pull-requests: write` / `issues: write`）；release 与 cleanup 使用 GitHub App。构建/测试 job 不获取 App 凭据。

Renovate 仅提供提示，从不自动合并。源码 commit、精确补丁/主题哈希、锁和 release tag 必须由人工一起更新。

## HA 限制

当前 deployment 是单副本 StatefulSet，`/data` 和 `/workspace` 使用 RWO。DSH 的 session 是进程内状态，只有 per-session `flock`，没有 home 级 leader election，也没有 live-session handoff。不要把副本扩到 2，也不要把共享 RWX home 当作 hot failover。PDB 只保护 voluntary disruption。证据、选项与 active/passive 的最低要求见 [HA plan](docs/ha-plan.md)。

## 许可与对应源码

本项目原创代码按 [LICENSE](LICENSE) 的 Apache-2.0 发布；上游 MIT 声明保存在 [NOTICE](NOTICE)。Tavern 是 **AGPL-3.0-only**；修改后的源码与构建配方保留在 Tavern 镜像中，认证用户可通过 `/distribution/source.tar.gz` 下载对应源码归档。部署时必须保持该源码提供可用；修改或再分发 Tavern 时履行 AGPL 义务。详见 [regulations](docs/regulations.md) 与 [source build](docs/source-build.md)。
