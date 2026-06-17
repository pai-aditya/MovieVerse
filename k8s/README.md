# MovieVerse on Kubernetes — DevOps / CKA Showcase

A production-shaped, **self-hosted, zero-cost** Kubernetes deployment of the
MovieVerse full-stack app. Runs on a real multi-node **kubeadm** cluster (lima
VMs on macOS — see [`kubeadm/README.md`](../kubeadm/README.md) for how it's
provisioned). Built to demonstrate CKA-level Kubernetes plus the surrounding
DevOps toolchain (Terraform-free, all open source). The manifests here are
cluster-agnostic.

## Architecture

```
                          ┌────────────────────── kubeadm cluster (4 nodes) ───────────────────────┐
                          │                                                                         │
  Browser ── localhost:8080 ──► edge-proxy (nginx) ──► Service ──► movieverse-frontend (nginx SPA)  │
                          │                    └────► /api ───► movieverse-backend (Express, x2)     │
                          │                                          │  envFrom ConfigMap + Secret   │
                          │                                          ▼                               │
                          │                            postgres (StatefulSet, PVC)  ◄── tainted      │
                          │                                                              "database"  │
                          │   observability:  Prometheus ── scrapes pod /metrics ──► Grafana         │
                          │                   Promtail (DaemonSet) ── ships logs ──► Loki ──► Grafana │
                          │   secrets:        Vault (dev)        gitops: ArgoCD ── syncs ── Git       │
                          └─────────────────────────────────────────────────────────────────────────┘
```

| Layer | Tech |
|-------|------|
| App | Node.js/Express (backend), React+Vite served by nginx (frontend) |
| Data | PostgreSQL (StatefulSet) with sessions in `connect-pg-simple` so the API scales horizontally |
| Cluster | **kubeadm** — 1 control-plane + 3 workers (2 general, 1 tainted database node), lima VMs, Flannel CNI, k8s v1.31 |
| Edge | `edge-proxy` (docker.io nginx): `/` → frontend, `/api` → backend, same-origin; reached via `port-forward` (stands in for ingress) |
| Autoscaling | HPA v2 (CPU+memory) — needs metrics-server |
| Config/Secrets | ConfigMap + Secret; HashiCorp Vault (dev) demo component |
| Monitoring | Prometheus (self-hosted) + Grafana (provisioned dashboards/datasources) |
| Logging | Loki + Promtail (DaemonSet) |
| GitOps | ArgoCD Application syncing the Kustomize overlay |
| Config mgmt | Kustomize base + dev/prod/local overlays |
| CI | GitHub Actions: image build + Trivy scan + push; manifest validation (kubeconform) |

## Quick start

The cluster lives in `kubeadm/` (see [`kubeadm/README.md`](../kubeadm/README.md)):

```bash
./kubeadm/cluster-up.sh        # provision lima VMs, kubeadm init, Flannel, join, label/taint
./kubeadm/load-images.sh       # build app images + import into each worker's containerd
./kubeadm/deploy.sh            # storage (local-path) + app (local overlay) + edge-proxy
export KUBECONFIG=$HOME/.kube/kubeadm-mv.conf

kubectl -n movieverse port-forward svc/edge-proxy 8080:80   # browse http://localhost:8080

# observability (optional; all docker.io images)
kubectl apply -f k8s/monitoring/prometheus.yaml -f k8s/monitoring/grafana.yaml
kubectl apply -f k8s/logging/loki.yaml -f k8s/logging/promtail.yaml

./kubeadm/down.sh              # delete the cluster (lima VMs)
```

Because this cluster pulls from `registry.k8s.io` (via the trusted corp CA) it can
also run real **ingress-nginx** and **metrics-server** — unlike the retired kind
setup, where those images were unreachable.

## Directory layout

```
kubeadm/             lima template + scripts: cluster-up, load-images, deploy, down, etcd-backup
k8s/
├── namespaces/      namespaces, ResourceQuota, LimitRange, NetworkPolicies
├── rbac/            ServiceAccount + Role/RoleBinding + ClusterRole
├── scheduling/      PriorityClasses
├── app/             backend/frontend Deployments, Services, HPA, PDB, ConfigMap, Secret, migration Job
├── database/        PostgreSQL StatefulSet + headless Service + backup CronJob
├── ingress/         path-based Ingress (for clusters with an ingress controller)
├── local/           edge-proxy + local-path-provisioner (laptop/kubeadm helpers)
├── monitoring/      Prometheus + Grafana (+ optional operator ServiceMonitor)
├── logging/         Loki + Promtail DaemonSet
├── vault/           Vault dev StatefulSet
├── argocd/          ArgoCD Application + AppProject
└── kustomize/       base + overlays/{dev,prod,local}
```

## CKA topics demonstrated

- **Cluster architecture**: **hand-bootstrapped with `kubeadm`** (init/join, static
  pods, real etcd, certs, kubelet on systemd), node labels, **taints & tolerations**
  (dedicated database node), `etcdctl snapshot` of real etcd (`kubeadm/etcd-backup.sh`).
- **Workloads & scheduling**: Deployments (rolling update, `maxUnavailable: 0`),
  **StatefulSet** + headless Service + `volumeClaimTemplates`, **DaemonSet**
  (Promtail), **Job** (migration) + **CronJob** (backup), `initContainers`,
  **nodeAffinity / podAntiAffinity / topologySpreadConstraints**, **PriorityClasses**.
- **Services & networking**: ClusterIP + headless Services, **Ingress** with regex
  rewrite, **NetworkPolicies** (default-deny + scoped allows).
- **Storage**: StorageClass (`standard`), PVCs, StatefulSet volume templates.
- **Config**: ConfigMap + Secret via `envFrom`/`secretKeyRef`, **Kustomize**
  overlays.
- **Security**: **RBAC** (Role/RoleBinding/ClusterRole), `securityContext`
  (runAsNonRoot, drop ALL caps, no privilege escalation), `automountServiceAccountToken: false`.
- **Reliability**: liveness/readiness/**startup** probes, **HPA**, **PDB**,
  ResourceQuota + LimitRange.
- **Observability**: Prometheus service discovery, Grafana, Loki/Promtail.
- **Troubleshooting**: see the cheatsheet below.

## Notes & deliberate tradeoffs

- **NetworkPolicies need a policy-enforcing CNI.** This cluster uses **Flannel**,
  which does not enforce NetworkPolicies, so `k8s/namespaces/network-policies.yaml`
  is applied separately and only takes effect if you swap the CNI for Calico. The
  manifests are valid and reviewed regardless.
- **Kustomize `LoadRestrictionsNone`.** The base references topical sibling
  directories (cleaner to browse than one flat `base/`), so builds use
  `--load-restrictor LoadRestrictionsNone`. For ArgoCD set
  `kustomize.buildOptions: --load-restrictor LoadRestrictionsNone` in `argocd-cm`.
- **Secrets are committed in plaintext** for a throwaway local cluster only. The
  Vault component and comments show the intended path (Vault Agent Injector /
  Sealed Secrets / External Secrets) for a real cluster.
- **Vault runs in dev mode** (in-memory, root token) as a demo; the app reads K8s
  Secrets so the cluster boots even if Vault is down.

## GitOps with ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# allow the topical-dir kustomize layout:
kubectl -n argocd patch cm argocd-cm --type merge \
  -p '{"data":{"kustomize.buildOptions":"--load-restrictor LoadRestrictionsNone"}}'
kubectl apply -f k8s/argocd/application.yaml   # update repoURL to your fork first
```

## CI/CD workflows (`.github/workflows/`)

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `validate-manifests.yml` | `k8s/**` changes | Renders the Kustomize overlays and validates every manifest against the Kubernetes JSON schemas (kubeconform). |
| `build-images.yml` | `backend/**`/`frontend/**` changes | Builds both images, scans them with Trivy (results to GitHub Security), pushes to GHCR. |

> The previous kind-based end-to-end CI was removed with kind: a kubeadm/lima
> cluster can't run on standard GitHub-hosted runners (no nested virtualization).
> End-to-end is exercised locally via `kubeadm/` instead.

## Troubleshooting cheatsheet

```bash
kubectl -n movieverse get pods -o wide
kubectl -n movieverse describe pod <pod>          # events, probe failures, scheduling
kubectl -n movieverse logs deploy/movieverse-backend -f
kubectl -n movieverse get events --sort-by=.lastTimestamp
kubectl -n movieverse exec deploy/movieverse-backend -- wget -qO- localhost:5555/ready
kubectl top pods -n movieverse                    # needs metrics-server
kubectl -n movieverse get hpa movieverse-backend  # autoscaling status
```
