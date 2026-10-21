# Deploy examples

Application-side examples only. They do not install or configure Authentik,
the verified edge, TLS termination, DNS or a model provider. The edge remains
responsible for OIDC/MFA, removing client-supplied `x-authentik-*` headers,
injecting exactly one verified stable UID, preserving public `Host`/`Origin`,
and forwarding WebSocket upgrades.

Pin an inspected `@sha256:…` digest in production. The version tags in these
examples match `versions.json` but are not a substitute for digest pinning.

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
`172.30.80.4:3080` (Tavern) from the same private network. Web and Tavern must
never share a live `/data` volume.

## Kubernetes

`deploy/kubernetes/dsh-web.yaml` is a single-replica StatefulSet with separate
`/data` and `/workspace` claims. It binds DSH to the Pod IP via the downward
API; do not replace that with the Service VIP or a wildcard address.

Create the namespace and referenced Secret first:

```bash
kubectl create namespace dsh
kubectl -n dsh create secret generic dsh-web-sso \
  --from-literal=allowed-uids='<stable-authentik-uid>' \
  --from-literal=trusted-proxy-cidrs='<edge-pod-cidr>'
```

Restrict the Pod with the platform's network policy so only the verified edge
can reach port `3080`; the manifest does not guess your edge namespace.
