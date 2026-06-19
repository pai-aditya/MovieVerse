# MovieVerse

MovieVerse is a full-stack movie discovery and social platform — browse movies
(via The Movie DB API), write reviews, keep a watchlist, and build custom lists.

But the application is deliberately ordinary. **The point of this repository is the
DevOps / Kubernetes platform around it.** MovieVerse is a portfolio project that
takes a normal three-tier web app and runs it the way a real team would: a real
multi-node Kubernetes cluster bootstrapped by hand with `kubeadm`, container
images, persistent storage, monitoring, logging, secrets management, GitOps, and
CI — all self-hosted, open-source, and zero-cost.

> **New here? Read [`docs/`](docs/) in this order:**
> 1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the whole thing fits together
> 2. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — bring it up from scratch
> 3. [docs/OPERATIONS.md](docs/OPERATIONS.md) — run it day-to-day + troubleshoot
> 4. [docs/DECISIONS.md](docs/DECISIONS.md) — *why* it's built this way (the full story)
> 5. [docs/CKA-MAPPING.md](docs/CKA-MAPPING.md) — how it maps to the CKA exam

---

## What's in the box

| Tier | Technology | Where |
|------|-----------|-------|
| Frontend | React 18 + Vite + Tailwind, served by nginx | [`frontend/`](frontend/) ([README](frontend/README.md)) |
| Backend | Node.js + Express, Passport auth, Prometheus metrics | [`backend/`](backend/) ([README](backend/README.md)) |
| Database | PostgreSQL (relational schema, sessions table) | [`backend/db/schema.sql`](backend/db/schema.sql) |
| Containers | Multi-stage Dockerfiles (backend + frontend) | `*/Dockerfile` |
| Cluster | **kubeadm** — 4 lima VMs (1 control-plane + 3 workers) | [`kubeadm/`](kubeadm/) ([README](kubeadm/README.md)) |
| Workloads | Deployments, StatefulSet, Job/CronJob, DaemonSet, HPA, PDB | [`k8s/`](k8s/) ([README](k8s/README.md)) |
| Config mgmt | Kustomize base + `dev`/`prod`/`local` overlays | [`k8s/kustomize/`](k8s/kustomize/) |
| Monitoring | Prometheus + Grafana | [`k8s/monitoring/`](k8s/monitoring/) |
| Logging | Loki + Promtail (DaemonSet) | [`k8s/logging/`](k8s/logging/) |
| Secrets | HashiCorp Vault (dev) | [`k8s/vault/`](k8s/vault/) |
| GitOps | ArgoCD Application | [`k8s/argocd/`](k8s/argocd/) |
| CI | GitHub Actions: image build + Trivy scan; kubeconform validation | [`.github/workflows/`](.github/workflows/) |

Everything is **open-source and runs locally** — no cloud account, no paid
services. (An earlier exploration of AWS EKS was dropped on cost grounds; see
[docs/DECISIONS.md](docs/DECISIONS.md).)

## Architecture at a glance

```
                         ┌──────────────────── kubeadm cluster (4 lima VMs) ───────────────────┐
                         │                                                                      │
 Browser ─ localhost:8080 ─► edge-proxy (nginx) ─► Service ─► movieverse-frontend (nginx SPA)   │
   (kubectl port-forward)  │                  └─► /api ─► movieverse-backend (Express, x2)       │
                         │                                       │ envFrom ConfigMap + Secret    │
                         │                                       ▼                               │
                         │                          postgres (StatefulSet, PVC) ◄── tainted node │
                         │   metrics:  Prometheus ─ scrapes /metrics ─► Grafana                  │
                         │   logs:     Promtail (DaemonSet) ─► Loki ─► Grafana                   │
                         │   secrets:  Vault (dev)      gitops: ArgoCD ─ syncs ─ Git             │
                         └──────────────────────────────────────────────────────────────────────┘
   nodes: mv-cp (control-plane) · mv-w1, mv-w2 (tier=general) · mv-w3 (tier=database, tainted)
```

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (TL;DR)

Prereqs: macOS with [`colima`](https://github.com/abiosoft/colima),
[`lima`](https://lima-vm.io/), `kubectl`, and `docker` (colima provides the
engine). On a TLS-intercepting corporate network you also need a CA bundle at
`~/.movieverse-ca/corp-ca.pem` — see [docs/OPERATIONS.md](docs/OPERATIONS.md).

```bash
colima start --runtime docker          # Docker engine used only to build images
./kubeadm/cluster-up.sh                # provision VMs, kubeadm init, CNI, join, label/taint
./kubeadm/load-images.sh               # build app images + import into each worker's containerd
./kubeadm/deploy.sh                    # storage + app + edge-proxy
export KUBECONFIG=$HOME/.kube/kubeadm-mv.conf
kubectl -n movieverse port-forward svc/edge-proxy 8080:80   # browse http://localhost:8080
```

Full walkthrough (including monitoring, logging, Vault, ingress-nginx,
metrics-server) in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### CI/CD with per-branch preview environments

The above is the **manual** single-namespace deploy. The repo also runs a
self-hosted **Jenkins + ArgoCD** pipeline: push any branch → Jenkins builds/pushes
images to ghcr and applies a per-branch ArgoCD `Application` → the branch deploys
into its own `mv-<slug>` namespace and is live at **`http://localhost:<port>`**
(no port-forward; the URL is shown on the ArgoCD Application page). Bring the whole
stack up after a teardown with one command:

```bash
GHCR_USER=<github-user> GHCR_PAT=<pat-with-write:packages> ./setup.sh
```

Full runbook in [cicd/README.md](cicd/README.md).

## Local development (no Kubernetes)

```bash
# backend (needs a local PostgreSQL; see backend/README.md)
cd backend && npm install && npm run dev     # http://localhost:5555

# frontend
cd frontend && npm install && npm run dev     # http://localhost:5173
```

## Repository map

```
backend/        Express API, PostgreSQL data layer, Dockerfile        (see backend/README.md)
frontend/       React SPA, nginx Dockerfile                           (see frontend/README.md)
k8s/            All Kubernetes manifests, by topic                    (see k8s/README.md)
kubeadm/        lima VM template + cluster provisioning scripts       (see kubeadm/README.md)
docs/           Architecture, deployment, operations, decisions, CKA  (see docs/)
.github/        CI workflows (image build + manifest validation)
CLAUDE.md       Guidance for AI assistants working in this repo
```

## Author

- GitHub: [pai-aditya](https://github.com/pai-aditya)
- Email: pai.aditya2011@gmail.com
