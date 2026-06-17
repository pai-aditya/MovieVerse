# CKA Topic Mapping

How this project exercises the **Certified Kubernetes Administrator** curriculum —
useful as interview talking points, and as a checklist of what's demonstrated.
The CKA domains and their exam weights:

| Domain | Weight |
|--------|--------|
| Cluster Architecture, Installation & Configuration | 25% |
| Workloads & Scheduling | 15% |
| Services & Networking | 20% |
| Storage | 10% |
| Troubleshooting | 30% |

---

## Cluster Architecture, Installation & Configuration (25%)

| CKA skill | Where in this repo |
|-----------|--------------------|
| Bootstrap a cluster with **kubeadm** (`init`/`join`) | `kubeadm/cluster-up.sh`, `kubeadm/README.md` |
| Install a **CNI** | Flannel install in `cluster-up.sh` |
| Manage kubelet / containerd / certs / static pods | provisioned per node in `kubeadm/lima-k8s-node.yaml`; static pods in `/etc/kubernetes/manifests` on `mv-cp` |
| **RBAC** (Roles, ClusterRoles, bindings, ServiceAccounts) | `k8s/rbac/rbac.yaml` (least-privilege app SA + read-only ClusterRole) |
| Manage **etcd** (backup/restore) | `kubeadm/etcd-backup.sh` (snapshots the real etcd static pod) |
| Use **Kustomize** to manage manifests | `k8s/kustomize/` base + dev/prod/local overlays |
| Cluster upgrades | `kubeadm upgrade` flow applies to this real cluster (not exercised in scripts, but available) |

## Workloads & Scheduling (15%)

| CKA skill | Where |
|-----------|-------|
| **Deployments** + rolling updates | `k8s/app/backend.yaml`, `frontend.yaml` (`maxUnavailable: 0`) |
| **StatefulSet** + stable identity + `volumeClaimTemplates` | `k8s/database/postgres.yaml` |
| **DaemonSet** | `k8s/logging/promtail.yaml` (one per node) |
| **Jobs** & **CronJobs** | `k8s/app/migration-job.yaml`, `k8s/database/backup-cronjob.yaml` |
| **Taints & tolerations** | `mv-w3` tainted `dedicated=database:NoSchedule`; Postgres tolerates |
| **nodeAffinity / podAntiAffinity / topologySpread** | `k8s/app/backend.yaml`, `k8s/database/postgres.yaml` |
| **PriorityClasses** | `k8s/scheduling/priorityclasses.yaml` |
| Resource requests/limits, **ResourceQuota**, **LimitRange** | `k8s/namespaces/` + every workload |
| **HPA** (autoscaling) | `k8s/app/hpa.yaml` (CPU+memory; needs metrics-server) |
| Init containers / multi-container patterns | `wait-for-postgres` init container in backend + migration Job |
| Probes (startup/liveness/readiness) | `k8s/app/backend.yaml` |
| **PodDisruptionBudget** | `k8s/app/pdb.yaml` |

## Services & Networking (20%)

| CKA skill | Where |
|-----------|-------|
| Service types (ClusterIP, **headless**) | app Services; headless `postgres` for the StatefulSet |
| **Ingress** (path-based routing, rewrite) | `k8s/ingress/ingress.yaml`; ingress-nginx as an add-on |
| **NetworkPolicies** (default-deny + scoped allows) | `k8s/namespaces/network-policies.yaml` (enforced only with a policy CNI like Calico) |
| CoreDNS / service discovery | in-cluster DNS used throughout (`postgres`, `loki.logging`, …) |
| CNI pod networking | Flannel, pod CIDR `10.244.0.0/16` |

## Storage (10%)

| CKA skill | Where |
|-----------|-------|
| **StorageClass** + dynamic provisioning | `standard` SC + `k8s/local/local-path-provisioner.yaml` |
| **PV / PVC** | Postgres `volumeClaimTemplates`, backups PVC |
| Volume binding modes | `WaitForFirstConsumer` on `standard` |
| `hostPath` / `emptyDir` / ConfigMap & Secret volumes | Promtail hostPath, Prometheus emptyDir, mounted configs |

## Troubleshooting (30%)

This is the project's strongest area — the [DECISIONS.md "bugs"](DECISIONS.md#bugs-found-and-fixed-along-the-way)
and [OPERATIONS.md cheatsheet](OPERATIONS.md#troubleshooting-cheatsheet) are real,
worked examples:

| CKA skill | Demonstrated by |
|-----------|-----------------|
| Read pod **events**/describe to find scheduling failures | LimitRange-min rejection; taint/affinity placement |
| Debug **image pull** failures | registry.k8s.io TLS interception; per-node image import; post-sleep DNS |
| Debug **RBAC** failures | local-path provisioner forbidden to create helper pods |
| Debug **probes / CrashLoopBackOff** | Promtail inotify limit; readiness gated on DB |
| Diagnose **node NotReady** / DNS | host-sleep gvproxy recovery |
| Inspect logs / `exec` into pods | throughout OPERATIONS.md |
| Cluster access / kubeconfig / API server reachability | host kubeconfig + lima forward / SSH tunnel |

## Beyond CKA (platform/SRE signal)

- **Observability:** Prometheus (service discovery + alert rules) + Grafana
  (provisioned dashboards) + Loki/Promtail.
- **GitOps:** ArgoCD Application (auto-sync, self-heal).
- **CI:** GitHub Actions — image build + Trivy scan + kubeconform manifest validation.
- **Secrets:** Vault (dev) as the intended secrets path.
- **12-factor app:** stateless API with sessions externalized to Postgres → scales horizontally.
