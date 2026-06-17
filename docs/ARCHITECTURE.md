# Architecture

This document explains how MovieVerse fits together, from the application code up
through the Kubernetes platform. It assumes no prior knowledge of the project.

- [1. The big picture](#1-the-big-picture)
- [2. Application tier](#2-application-tier)
- [3. Data model](#3-data-model)
- [4. Authentication & sessions](#4-authentication--sessions)
- [5. Operational endpoints](#5-operational-endpoints)
- [6. Containers](#6-containers)
- [7. The Kubernetes cluster](#7-the-kubernetes-cluster)
- [8. Kubernetes workloads](#8-kubernetes-workloads)
- [9. Networking & access](#9-networking--access)
- [10. Observability](#10-observability)
- [11. Config management (Kustomize)](#11-config-management-kustomize)
- [12. GitOps & CI](#12-gitops--ci)
- [13. Request lifecycle (end to end)](#13-request-lifecycle-end-to-end)

---

## 1. The big picture

MovieVerse is a standard **three-tier web application**:

```
React SPA  ──HTTP──►  Express API  ──SQL──►  PostgreSQL
(frontend)            (backend)              (database)
```

That app is packaged into **container images** and run on a **multi-node
Kubernetes cluster** that was bootstrapped by hand with `kubeadm` on local Linux
VMs. Around the app sit the things a production platform needs: persistent
storage, autoscaling, health checks, monitoring, logging, secrets, GitOps, and CI.

The application is intentionally simple so the focus stays on the platform.

## 2. Application tier

### Frontend (`frontend/`)
- **React 18 + Vite + Tailwind CSS**, a Single-Page Application.
- Built by Vite into static assets, served by **nginx** (see
  `frontend/Dockerfile`, a two-stage build: stage 1 compiles, stage 2 serves).
- The backend's base URL is injected at **build time** via `VITE_SERVER_URL`
  (defined in `frontend/src/components/Constants.jsx`). This is baked into the JS
  bundle — there is no runtime config — which is why the image is rebuilt when the
  API URL changes.

### Backend (`backend/`)
A small, modular Express app (Node.js, ES modules):

| File | Responsibility |
|------|----------------|
| `index.js` | Express app, Passport auth setup, ~30 routes, startup logic, mappers |
| `db.js` | `pg` connection pool, `query()` helper, `initSchema()`, `checkConnection()` |
| `db/schema.sql` | Idempotent relational schema (the source of truth for tables) |
| `migrate.js` | Standalone schema runner (`npm run migrate`; used by the K8s migration Job) |
| `metrics.js` | `prom-client` registry + Express middleware exposed at `/metrics` |

Routes are grouped by feature: `/auth/*`, `/review/*`, `/watchlist/*`,
`/lists/*`, plus the operational endpoints `/health`, `/ready`, `/metrics`.
See [backend/README.md](../backend/README.md) for the full API.

### Database
**PostgreSQL.** A normalized relational schema (see [section 3](#3-data-model)).
The project was originally MongoDB/Mongoose and was migrated to PostgreSQL — see
[docs/DECISIONS.md](DECISIONS.md) for why and how.

## 3. Data model

`backend/db/schema.sql` defines five tables plus a session table:

```
users ──┬──< reviews        (UNIQUE(user_id, movie_id); review submit is an upsert)
        ├──< watchlist
        └──< lists ──< list_movies
session                     (managed by connect-pg-simple)
```

- All child tables have `... REFERENCES users(id) ON DELETE CASCADE`, so deleting
  a user cleanly removes their reviews/watchlist/lists.
- **API compatibility:** the original MongoDB API returned `_id` strings and
  camelCase fields. The backend's mapper functions (`mapReview`, `mapMovie`,
  `mapList`, `mapUser` in `index.js`) translate integer PKs → `_id` strings and
  snake_case columns → camelCase, so the React frontend works unchanged against
  PostgreSQL.

## 4. Authentication & sessions

- **Passport.js** with two strategies:
  - **Local** (username/password): passwords hashed with `crypto.pbkdf2`
    (salt + hash stored on the `users` row), verified with a timing-safe compare.
  - **Google OAuth** (optional): enabled only if `CLIENT_ID`/`CLIENT_SECRET` are
    set; otherwise the app boots fine with local auth only.
- **Sessions live in PostgreSQL** via `connect-pg-simple` (the `session` table),
  *not* in the server's memory. This is the key design choice that lets the
  backend run as **multiple replicas** behind a Service — any replica can serve
  any request because the session is in the shared database. `serializeUser`
  stores only the user id; `deserializeUser` reloads the row per request.
- Cookies: `secure`/`sameSite` are driven by `COOKIE_SECURE`. `app.set('trust proxy', 1)`
  is set so secure cookies and client IPs work behind an ingress/proxy.

## 5. Operational endpoints

These exist purely so Kubernetes (and Prometheus) can manage the app:

| Endpoint | Purpose | Touches DB? |
|----------|---------|-------------|
| `GET /health` | **Liveness** — "is the process alive?" | No (so a transient DB outage never restarts pods) |
| `GET /ready` | **Readiness** — "can it serve traffic?" | Yes (`SELECT 1`); also gated on schema being applied |
| `GET /metrics` | Prometheus metrics (default process metrics + HTTP counters/histograms) | No |

On startup the app begins serving immediately (so liveness passes) and applies
the schema with retries in the background; `/ready` only returns 200 once the DB
is reachable and the schema is applied (`dbReady` flag).

## 6. Containers

- `backend/Dockerfile` — `node:20-alpine`, `npm ci --omit=dev`, runs as the
  non-root `node` user, `CMD ["node", "index.js"]`.
- `frontend/Dockerfile` — stage 1 builds with Vite (`VITE_SERVER_URL` build-arg),
  stage 2 serves the static bundle with `nginx:alpine` (`nginx.conf` adds SPA
  fallback so client-side routes resolve).
- Images are tagged `movieverse-backend:latest` / `movieverse-frontend:latest`
  and consumed with `imagePullPolicy: IfNotPresent` (they live locally on the
  nodes; there is no registry in the local setup).

## 7. The Kubernetes cluster

A real **kubeadm** cluster (Kubernetes v1.31) running on **four lima VMs** on
macOS. Provisioned by [`kubeadm/cluster-up.sh`](../kubeadm/cluster-up.sh); details
in [kubeadm/README.md](../kubeadm/README.md).

| VM | Role | Labels / taint | Hosts |
|----|------|----------------|-------|
| `mv-cp`  | control-plane | — | apiserver, etcd, scheduler, controller-manager |
| `mv-w1`  | worker | `tier=general` | app/observability pods |
| `mv-w2`  | worker | `tier=general` | app/observability pods |
| `mv-w3`  | worker | `tier=database` + taint `dedicated=database:NoSchedule` | **PostgreSQL only** |

- **CNI:** Flannel (pod CIDR `10.244.0.0/16`).
- **Container runtime:** containerd with `SystemdCgroup=true`.
- **VM-to-VM networking:** lima's `user-v2` network (no sudo needed) — IPs are
  stable per-VM by MAC: `mv-cp` = 192.168.104.1, gateway = .2, workers = .3/.4/.5.

The tainted database node demonstrates **taints + tolerations + nodeAffinity**:
only the Postgres pod tolerates `dedicated=database` and is required onto
`tier=database`, so it lands exclusively on `mv-w3`.

## 8. Kubernetes workloads

All manifests live under `k8s/`, organized by topic. ([k8s/README.md](../k8s/README.md))

| Manifest area | Kind(s) | Notes |
|---------------|---------|-------|
| `k8s/namespaces/` | Namespace, ResourceQuota, LimitRange, NetworkPolicy | `movieverse`, `monitoring`, `logging`, `vault`; quota+limits on the app ns |
| `k8s/rbac/` | ServiceAccount, Role/RoleBinding, ClusterRole | least-privilege; `automountServiceAccountToken: false` |
| `k8s/scheduling/` | PriorityClass | database > web tier |
| `k8s/database/` | StatefulSet + headless Service + backup CronJob | stable identity + PVC; nightly `pg_dump` |
| `k8s/app/` | Deployment ×2, Service ×2, HPA, PDB, ConfigMap, Secret, migration Job | probes, anti-affinity, topology spread, securityContext |
| `k8s/ingress/` | Ingress | path-based `/` → frontend, `/api` → backend |
| `k8s/local/` | edge-proxy, local-path-provisioner | local/kubeadm helpers (see [networking](#9-networking--access)) |
| `k8s/monitoring/` | Prometheus + Grafana (+ optional operator CRs) | self-hosted |
| `k8s/logging/` | Loki + Promtail DaemonSet | |
| `k8s/vault/` | Vault dev StatefulSet | secrets-management demo |
| `k8s/argocd/` | ArgoCD Application + AppProject | GitOps |

**Reliability features baked into the backend Deployment:** rolling updates with
`maxUnavailable: 0`, `startupProbe` → `livenessProbe` (/health) → `readinessProbe`
(/ready), an init container that waits for Postgres TCP, `podAntiAffinity` +
`topologySpreadConstraints` to spread replicas across nodes, an **HPA** (CPU+memory)
and a **PodDisruptionBudget** (minAvailable 1).

## 9. Networking & access

The app is reached at **`http://localhost:8080`** via:

```
browser ─► localhost:8080 ─(kubectl port-forward)─► edge-proxy (Service) ─┬─► movieverse-frontend  (/)
                                                                          └─► movieverse-backend   (/api/*, prefix stripped)
```

- **`edge-proxy`** (`k8s/local/edge-proxy.yaml`) is a tiny docker.io `nginx` that
  serves `/` from the frontend and proxies `/api/*` to the backend (stripping the
  prefix). It gives **same-origin** access (SPA and API on the same host:port), so
  session cookies work without CORS gymnastics or an `/etc/hosts` entry.
- A real **Ingress** (`k8s/ingress/ingress.yaml`) does the same routing for
  clusters with an ingress controller; the `local` overlay makes it host-less.
  **ingress-nginx** can be (and has been) installed on this cluster — see
  [docs/DEPLOYMENT.md](DEPLOYMENT.md#optional-add-ons).
- **Why a port-forward / edge-proxy instead of just the Ingress?** lima does not
  forward privileged host ports (80) without root, and `/etc/hosts` edits need
  sudo. A `port-forward` to a high port sidesteps both. See [docs/DECISIONS.md](DECISIONS.md).
- **kubectl from the host** uses `~/.kube/kubeadm-mv.conf`, whose server is
  `https://127.0.0.1:6443` (the apiserver cert has a `127.0.0.1` SAN, and lima
  auto-forwards the apiserver port from `mv-cp`).

## 10. Observability

- **Metrics:** **Prometheus** (`k8s/monitoring/prometheus.yaml`) self-discovers
  pods via the `prometheus.io/scrape` annotations on the backend and scrapes
  their `/metrics`. It also scrapes kubelet cAdvisor and carries alert rules.
- **Dashboards:** **Grafana** (`k8s/monitoring/grafana.yaml`) is provisioned with
  Prometheus + Loki datasources and a starter "MovieVerse Overview" dashboard
  (request rate by route, p95 latency, pods up).
- **Logs:** **Promtail** (a DaemonSet on every node) tails container logs and
  ships them to **Loki**; Grafana's Explore view queries them (`{namespace="movieverse"}`).
- **Autoscaling input:** **metrics-server** (optional add-on) feeds the HPA real
  CPU/memory; without it the HPA shows `<unknown>`.

Think: **Prometheus = metrics, Loki = logs, Grafana = the single pane of glass.**

## 11. Config management (Kustomize)

`k8s/kustomize/` has a **base** and three **overlays**:

| Overlay | Replicas | Image tags | Notes |
|---------|----------|-----------|-------|
| `dev`   | 1 each | `latest` | minimal |
| `prod`  | backend 3 / frontend 2 | `stable` | resource bump, HA |
| `local` | 1 each | `latest` | **what runs on the kubeadm cluster**: host-less Ingress + `localhost:8080` same-origin config |

Because the base references topical sibling directories (cleaner to browse than
one flat folder), Kustomize builds require
`--load-restrictor LoadRestrictionsNone`. For ArgoCD this is set via
`kustomize.buildOptions` in `argocd-cm`.

## 12. GitOps & CI

- **GitOps:** `k8s/argocd/application.yaml` defines an ArgoCD `Application` that
  syncs an overlay from Git (auto-sync + self-heal). ArgoCD makes the cluster
  match Git — no manual `kubectl apply` in steady state.
- **CI** (`.github/workflows/`):
  - `validate-manifests.yml` — renders the overlays and validates every manifest
    against the Kubernetes JSON schemas (kubeconform).
  - `build-images.yml` — builds both images, scans with Trivy (results to GitHub
    Security), pushes to GHCR.

## 13. Request lifecycle (end to end)

A login request, traced through every layer:

1. Browser loads the SPA from `http://localhost:8080/` (edge-proxy → frontend pod).
2. SPA calls `POST http://localhost:8080/api/login` → edge-proxy strips `/api` →
   `movieverse-backend` Service → one of the backend pods.
3. Backend's `passport-local` strategy looks up the user in PostgreSQL, verifies
   the pbkdf2 hash, and creates a session **row** in the `session` table; sets the
   `connect.sid` cookie.
4. Subsequent `GET /api/auth/check` carries the cookie → backend `deserializeUser`
   loads the session row from Postgres → returns the user (mapped to the `_id`
   shape) → SPA renders the logged-in UI.

Because the session lives in Postgres, step 4 can be served by a *different*
backend replica than step 3 — which is exactly why the API can scale horizontally.
