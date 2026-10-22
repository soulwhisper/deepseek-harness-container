# Deployment

The examples are application-side only. They do not install Authentik, Authelia,
the verified edge, TLS termination, DNS or a model provider. The edge remains
responsible for OIDC/MFA, removing client-supplied identity headers, injecting
exactly one stable subject header, preserving public Host/Origin, and forwarding
WebSocket upgrades.

Pin an inspected `@sha256:…` digest in production. The tags in the examples
match `versions.json` but are not a substitute for digest pinning.

## Before you deploy

| Requirement | Why it matters |
| --- | --- |
| Verified edge with a stable subject | DSH trusts only the configured peer CIDR and header |
| Concrete listener IP | `DSH_HOST` must be one container/Pod IP, never a VIP or wildcard |
| Public HTTPS URL | Used for `DSH_PUBLIC_URL`, native cookies and the Tavern Origin fence |
| Separate Web/Tavern homes | They must never share a live `/data` or `/workspace` |
| Encrypted backup target | State includes credentials, attachments and conversations |
| Pinned image digest | Tags are mutable; production identity must be a digest |

## Docker Compose

```bash
docker network create --subnet 172.30.80.0/24 dsh-private
cp deploy/docker/.env.example deploy/docker/.env
# Edit .env, then start Web:
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml up -d web
# Or Tavern, with its own volumes and listener IP:
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml --profile tavern up -d tavern
```

No host port is published. Point the edge at `172.30.80.3:3080` (Web) or
`172.30.80.4:3080` (Tavern) from the same private network. The examples mount:

| Volume | Container path |
| --- | --- |
| `dsh-<target>-data` | `/data` |
| `dsh-<target>-workspace` | `/workspace` |
| `dsh-<target>-cache` | `/cache` |
| `dsh-<target>-logs` | `/logs` |
| `dsh-<target>-backups` | `/backups` |

Web and Tavern must never share a live `/data` or `/workspace` volume. Cache,
logs and rollback roots are separate because they are not authoritative state.

## Kubernetes

`deploy/kubernetes/dsh-web.yaml` is a single-replica StatefulSet with separate
`/data` and `/workspace` PVCs. It binds DSH to the Pod IP via the downward API;
do not replace that with the Service VIP or a wildcard address. `/cache`,
`/logs` and `/backups` are non-authoritative emptyDir volumes with size limits
(cache 4Gi, logs 1Gi, rollback 10Gi). Replace them with PVCs if you need logs or
rollback copies to survive a Pod restart, and size the rollback root for one copy
of `/data/dsh` without cache/logs.

Create the namespace and referenced Secret first:

```bash
kubectl create namespace dsh
kubectl -n dsh create secret generic dsh-web-forward-auth \
  --from-literal=allowed-subjects='<stable-owner-subject>' \
  --from-literal=trusted-proxy-cidrs='<edge-pod-cidr>'
```

The example does not mount skills below `/data/home`. The preset providers
discover `<workspace>/.dsh/skills` and `<workspace>/.agents/skills`
automatically; `$DSH_HOME/skills` keeps the bundled recommendations. Register
`/workspace` as the DSH workspace rather than `/data/home`. If a deployment
needs an extra root, mount it outside HOME (for example a read-only ConfigMap at
`/skills`) and set `DSH_SKILL_DIRS`; leave the variable unset to use only the
native roots. See [State and backup](data-layout.md#workspace-and-home).

The image owns state seeding and its default environment. A deployment supplies
the listener identity, public URL, trusted hosts, forward-auth, persistence and
security. Do not add a `state-seed` init container and do not repeat
`DSH_HOME`, `HOME`, `DSH_PROFILE`, `DSH_BACKUP_ROOT` or `DSH_AGENTS_HOME` in
the workload. The app entrypoint materializes `/data/dsh` before starting DSH.

Restrict the Pod with the platform's network policy so only the verified edge can
reach port `3080`; the manifest does not guess your edge namespace. The plugin
logs `state=waiting-for-edge` at startup and `state=active` after the first
verified request. A missing identity logs `reason=missing-identity`; it does not
open a password or setup page. `state=broken` means local configuration or a
native contract failed; inspect the fixed reason category, not a subject or token
value.

Do not scale the StatefulSet to two replicas. DSH has no leader election or
live-session handoff, and one live writer per home is a hard constraint. Do not
add a PDB or shared RWX volume expecting hot failover.

## Readiness

Readiness is local only:

```bash
kubectl -n dsh exec dsh-web-0 -- node /opt/dsh/scripts/readiness.mjs
```

It succeeds only while the mandatory gate is registered and the Host is bound.
There is no unauthenticated public health endpoint. Readiness does not prove the
edge, IdP, model provider or sandbox works.

## TLS and cookies

Native TLS is optional but recommended for the edge-to-DSH leg when it crosses an
untrusted network. Mount the certificate and key read-only, readable by subject
1000, set both `DSH_TLS_CERT` and `DSH_TLS_KEY`, and configure the edge to verify
the backend. Changing the native listener between HTTP and HTTPS changes the
native cookie identity; expect reauthentication. `DSH_PUBLIC_URL` alone enables
neither TLS nor a `Secure` cookie.

## First publication

Only `web-*` and `tavern-*` tags publish. A matching tag is validated against
`versions.json`, must be on `main`, is built and smoked on native amd64 and arm64
runners, and is combined into one multi-arch index. Do not deploy an unverified
local tag as production; use the published digest and retain the previous digest
and volume snapshots for rollback.
