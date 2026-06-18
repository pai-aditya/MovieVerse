# MovieVerse CI/CD — Jenkins + ArgoCD (self-hosted)

Push to **any branch** → Jenkins builds and pushes images to **ghcr.io** → ArgoCD
deploys that branch to its **own namespace on its own port**. Delete the branch →
the environment is torn down automatically. Delete a pod by hand → it comes back
(Deployment) and so does any deleted resource (ArgoCD `selfHeal`).

```
 git push (any branch)
        │  webhook / 2-min scan
        ▼
 ┌──────────────────────────┐     ghcr.io/pai-aditya/
 │ JENKINS (host / colima)  │────▶ movieverse-backend :<slug>-<sha>
 │ test → build → push      │      movieverse-frontend:<slug>-<sha>
 │ → refresh ArgoCD         │
 └──────────────────────────┘
        │ (ArgoCD SCM generator independently polls GitHub for branch heads)
        ▼
 ┌──────────────────────────┐
 │ ARGOCD ApplicationSet    │  per branch:
 │ render preview overlay   │   ns       = mv-<slug>
 │ inject ns/image/db/port  │   image    = :<slug>-<sha>
 │ automated + selfHeal     │   database = mv_<slug> (shared Postgres)
 └──────────────────────────┘   NodePort = 30000 + hash(branch)%2000
        ▼
 app live at  http://<node-ip>:<port>
```

## Layout

```
cicd/
├── jenkins/
│   ├── Jenkinsfile        # multibranch pipeline (test → build → push ghcr → refresh)
│   ├── Dockerfile         # Jenkins LTS + docker CLI + Node 20
│   ├── plugins.txt        # pinned plugins
│   ├── casc.yaml          # Config-as-Code: admin, creds (from env), the seed job
│   └── jenkins-up.sh      # build + `docker run` Jenkins on a fixed port (no compose)
└── argocd/
    ├── appproject.yaml    # project scoping (repo + namespaces)
    ├── app-of-apps.yaml   # the ONE thing you apply by hand
    ├── server-nodeport.yaml
    └── apps/
        ├── 00-shared-data.yaml     # shared Postgres + PriorityClasses + backup
        ├── 10-monitoring.yaml      # Prometheus :30090 + Grafana :30030
        ├── 20-logging.yaml         # Loki + Promtail
        ├── 30-vault.yaml           # Vault (dev)
        └── 40-preview-appset.yaml  # per-branch preview environments
```
The per-branch Kubernetes manifests live in `k8s/kustomize/overlays/preview/`
(and the shared data-plane in `…/overlays/shared/`) — the ApplicationSet renders
them with per-branch values injected.

## Fixed ports

| Service    | URL                              | How |
|------------|----------------------------------|-----|
| Jenkins    | `http://localhost:8080`          | host container port |
| ArgoCD     | `https://<node-ip>:30443`        | NodePort |
| Grafana    | `http://<node-ip>:30030`         | NodePort (admin/admin) |
| Prometheus | `http://<node-ip>:30090`         | NodePort |
| Branch app | `http://<node-ip>:<30000+hash>`  | NodePort (shown in the ArgoCD app) |

`<node-ip>` is any lima node's `192.168.104.x` address (`limactl list`, or
`kubectl get nodes -o wide`). If your host can't route to the node IPs, fall back
to `kubectl -n <ns> port-forward svc/<svc> <local>:<port>`.

---

## One-time setup

### 1. GitHub PAT
Create a **classic PAT** with `write:packages` (and `repo` if the repo is private).
Used by Jenkins to push to ghcr **and** to scan branches.

### 2. Install ArgoCD (via Helm — avoids the DNS-blocked raw.githubusercontent.com)
```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd -n argocd --create-namespace \
  --set 'configs.cm.kustomize\.buildOptions=--load-restrictor LoadRestrictionsNone' \
  --set-string 'configs.cm.accounts\.admin=apiKey\, login'
kubectl apply -f cicd/argocd/server-nodeport.yaml
# initial admin password:
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

### 3. GitHub token Secret for the ApplicationSet (branch discovery)
```bash
kubectl -n argocd create secret generic github-token --from-literal=token=<YOUR_GITHUB_PAT>
```

### 4. Bootstrap GitOps
```bash
kubectl apply -f cicd/argocd/appproject.yaml
kubectl apply -f cicd/argocd/app-of-apps.yaml

kubectl -n argocd port-forward svc/argocd-server 30443:443   

```
ArgoCD now syncs the platform stacks and starts creating a preview Application per
branch.

### 5. ArgoCD API token for Jenkins (optional but gives instant deploys)
```bash
argocd login localhost:30443 --username admin --password <argocd_password> --insecure
argocd account generate-token --account admin   # paste into ARGOCD_TOKEN below
```
Without it, deploys still happen on ArgoCD's next poll (≈ a couple minutes).

### 6. Start Jenkins (on the host, fixed port 8080)
```bash
export GHCR_USER=pai-aditya
export GHCR_PAT=<YOUR_GITHUB_PAT>
export ARGOCD_TOKEN=<YOUR_ARGOCD_TOKEN>      # from step 5; optional
export ARGOCD_SERVER=localhost:30443
export ADMIN_PASSWORD=admin
./cicd/jenkins/jenkins-up.sh
```

### 7. Make the ghcr packages public (one-time, after the first push)
On the first build Jenkins creates `movieverse-backend` / `movieverse-frontend`
packages under your GitHub account. In **GitHub → Packages → each package →
Settings → Change visibility → Public**. Public packages need **no imagePullSecret**
in the cluster. (To keep them private instead, see "Private packages" below.)

---

## Daily flow

```bash
git checkout -b feature/my-change
# ...edit...
git push -u origin feature/my-change
```
Within ~2 min: Jenkins builds `feature-my-change-<sha>`, pushes to ghcr, ArgoCD
creates namespace `mv-feature-my-change` and serves it on its NodePort. Find the
port in the ArgoCD UI (or `kubectl get svc -A | grep edge-proxy`).

Merge/delete the branch → ArgoCD prunes the namespace and its database stays on
the shared server (drop it manually if you want: `dropdb mv_feature_my_change`).

## Notes & alternatives

- **Trigger model:** default is **polling** (Jenkins scans every 2 min; the
  ApplicationSet polls GitHub) — no inbound exposure needed behind the corp
  network. For instant builds, expose Jenkins via `smee.io`/`ngrok` and add a
  GitHub webhook to `/github-webhook/`.
- **Private ghcr packages:** create a `dockerconfigjson` pull Secret and replicate
  it into every `mv-*` namespace (e.g. with `emberstack/reflector`), then add
  `imagePullSecrets` to the preview overlay. Public packages avoid all of this.
- **Port collisions:** NodePorts are `30000 + adler32(branch) % 2000`; two branch
  names could theoretically collide. Rename a branch or widen the modulus in
  `40-preview-appset.yaml` if it ever happens.
- **Resources:** each preview is frontend + backend + edge-proxy + a one-shot Job
  against the shared Postgres. On the 2 GiB nodes, keep ~3–4 previews live at once
  (or bump the lima workers to 4 GiB in `kubeadm/lima-k8s-node.yaml`).
