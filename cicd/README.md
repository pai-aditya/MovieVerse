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
 │ → kubectl apply an       │
 │   ArgoCD Application CR   │  per branch (rendered from preview-app.template.yaml):
 └──────────────────────────┘   ns       = mv-<slug>
        │ (applied to the cluster   image    = :<slug>-<sha>
        │  API as the least-priv     database = mv_<slug> (shared Postgres)
        │  jenkins-deployer SA)      NodePort = 30000 + adler32(branch)%2000
        ▼
 ┌──────────────────────────┐
 │ ARGOCD                   │  syncs mv-<slug>, automated + selfHeal
 │ sync preview overlay     │  (no hand-maintained branch list — Jenkins
 └──────────────────────────┘   self-registers every branch it builds)
        ▼
 app live at  http://localhost:<port>   (hostPort+lima, no port-forward; URL in ArgoCD)
```

> **Why Jenkins applies the Application (not an ArgoCD ApplicationSet)?** ArgoCD's
> GitHub *SCM Provider* generator is org-only (`GET /orgs/{org}/repos`), which 404s
> for a personal account. A *List* generator works but needs every branch typed in
> by hand. So instead Jenkins — which already iterates every branch — renders a
> per-branch `Application` from `argocd/preview-app.template.yaml` and `kubectl
> apply`s it. New branch → new environment, automatically, no list to maintain.

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
    ├── appproject.yaml             # project scoping (repo + namespaces)
    ├── app-of-apps.yaml            # the ONE thing you apply by hand
    ├── server-nodeport.yaml
    ├── jenkins-deployer-rbac.yaml  # least-priv SA Jenkins uses to register previews
    ├── preview-app.template.yaml   # per-branch Application; Jenkins renders+applies it
    └── apps/
        ├── 00-shared-data.yaml     # shared Postgres + PriorityClasses + backup
        ├── 10-monitoring.yaml      # Prometheus :30090 + Grafana :30030
        ├── 20-logging.yaml         # Loki + Promtail
        └── 30-vault.yaml           # Vault (dev)
```
The per-branch Kubernetes manifests live in `k8s/kustomize/overlays/preview/`
(and the shared data-plane in `…/overlays/shared/`) — Jenkins renders a per-branch
`Application` that points ArgoCD at this overlay with the per-branch values injected.

## Fixed ports

| Service    | URL                              | How |
|------------|----------------------------------|-----|
| Jenkins    | `http://localhost:8080`          | host container port |
| Branch app | `http://localhost:<30000+hash>`  | **hostPort + lima auto-forward — no port-forward** (URL shown in the ArgoCD app) |
| ArgoCD     | `https://localhost:30443`        | **hostPort on the server pod + lima auto-forward — no port-forward** |
| Grafana    | `http://localhost:30030`         | `kubectl -n monitoring port-forward svc/grafana 30030:80` (admin/admin) |
| Prometheus | `http://localhost:30090`         | `kubectl -n monitoring port-forward svc/prometheus 30090:9090` |

**Branch apps need no port-forward.** The Mac can't route to the lima node network
(`192.168.104.x`), and NodePorts are pure iptables rules with no socket, so lima
can't forward those. The preview overlay therefore also gives the `edge-proxy` pod
a **`hostPort`** equal to its port — a real listening socket that lima
auto-forwards to `127.0.0.1` (the same mechanism that exposes the API server on
`:6443`). So each branch is reachable at `http://localhost:<port>`, and that exact
URL is published on the Application page in ArgoCD (`spec.info` → "Preview URL").
**ArgoCD itself** uses the same trick: `setup.sh` patches a `hostPort: 30443` onto
the `argocd-server` pod (Recreate strategy, to avoid a same-node clash on rollout)
so the UI is reachable at `https://localhost:30443` with no port-forward. The
remaining platform services (Grafana, Prometheus) are singletons not worth a
hostPort, so they still use a one-off `port-forward`.

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
# Reach the UI at https://localhost:30443 with no port-forward — bind a hostPort on
# the server pod (a real socket lima auto-forwards; a NodePort alone can't be):
kubectl -n argocd patch deploy argocd-server --type=merge \
  -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}'
kubectl -n argocd patch deploy argocd-server --type=strategic \
  -p 'spec:
  template:
    spec:
      containers:
        - name: server
          ports: [{containerPort: 8080, hostPort: 30443}]'
# initial admin password:
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

### 3. Bootstrap GitOps
```bash
kubectl apply -f cicd/argocd/appproject.yaml
kubectl apply -f cicd/argocd/app-of-apps.yaml
# ArgoCD UI is already at https://localhost:30443 (hostPort patched in step 2).
```
ArgoCD now syncs the platform stacks (shared Postgres, monitoring, logging, vault).
Per-branch preview Applications are created by Jenkins (next steps), not here.

### 4. Jenkins deployer identity (least-privilege cluster access)
Jenkins registers previews by applying an `Application` CR, so it needs a token
that can manage Applications in the `argocd` namespace — nothing more:
```bash
kubectl apply -f cicd/argocd/jenkins-deployer-rbac.yaml
```
`jenkins-up.sh` reads the resulting `jenkins-deployer-token` to mint the kubeconfig
it mounts into the container (apiserver reached at `host.docker.internal:6443`).

### 5. Start Jenkins (on the host, fixed port 8080)
```bash
export GHCR_USER=pai-aditya
export GHCR_PAT=<YOUR_GITHUB_PAT>          # classic PAT, write:packages
export ADMIN_PASSWORD=admin
export KUBECONFIG=$HOME/.kube/kubeadm-mv.conf   # host kubeconfig with cluster access
./cicd/jenkins/jenkins-up.sh
```
(`jenkins-up.sh` uses `KUBECONFIG` once, on the host, only to read the deployer
token and write the container's kubeconfig — the container itself never gets your
admin creds.)

### 6. Make the ghcr packages public (one-time, after the first push)
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
Within ~2 min: Jenkins builds `feature-my-change-<sha>`, pushes to ghcr, then
`kubectl apply`s the rendered `Application` — ArgoCD creates namespace
`mv-feature-my-change` and serves it on its NodePort. Find the port in the ArgoCD
UI, or:
```bash
kubectl get svc -A -l app.kubernetes.io/part-of=movieverse | grep edge-proxy
```

**Teardown.** A deleted branch does *not* run a pipeline, so its preview must be
removed explicitly (this also prunes the namespace via the app's finalizer):
```bash
kubectl -n argocd delete application mv-feature-my-change
dropdb -h <postgres> mv_feature_my_change   # optional: reclaim the shared-DB database
```

## Notes & alternatives

- **Trigger model:** default is **polling** (Jenkins scans every 2 min and, on a
  build, applies the branch's Application — ArgoCD then syncs it) — no inbound
  exposure needed behind the corp network. For instant builds, expose Jenkins via
  `smee.io`/`ngrok` and add a GitHub webhook to `/github-webhook/`.
- **Private ghcr packages:** create a `dockerconfigjson` pull Secret and replicate
  it into every `mv-*` namespace (e.g. with `emberstack/reflector`), then add
  `imagePullSecrets` to the preview overlay. Public packages avoid all of this.
- **Port collisions:** NodePorts are `30000 + adler32(branch) % 2000`; two branch
  names could theoretically collide. Rename a branch or widen the modulus (in the
  Jenkinsfile `NODEPORT` calc and `preview-app.template.yaml`) if it ever happens.
- **Resources:** each preview is frontend + backend + edge-proxy + a one-shot Job
  against the shared Postgres. On the 2 GiB nodes, keep ~3–4 previews live at once
  (or bump the lima workers to 4 GiB in `kubeadm/lima-k8s-node.yaml`).
