# Deployment

How to bring MovieVerse up from nothing on a local **kubeadm** cluster, and how to
deploy the app and the supporting stack. Read [ARCHITECTURE.md](ARCHITECTURE.md)
first if you want the "why".

- [0. Prerequisites](#0-prerequisites)
- [1. The corporate-CA requirement](#1-the-corporate-ca-requirement)
- [2. Start the Docker engine (colima)](#2-start-the-docker-engine-colima)
- [3. Provision the cluster](#3-provision-the-cluster)
- [4. Build & load the app images](#4-build--load-the-app-images)
- [5. Deploy the app](#5-deploy-the-app)
- [6. Access the app](#6-access-the-app)
- [7. Observability](#7-observability)
- [8. Optional add-ons](#8-optional-add-ons)
- [9. Tear down](#9-tear-down)
- [10. What each script does](#10-what-each-script-does)

---

## 0. Prerequisites

macOS (Apple Silicon, tested on macOS 26 / arm64) with:

| Tool | Install | Used for |
|------|---------|----------|
| `colima` | `brew install colima` | Docker engine (only to **build** images) |
| `lima` (`limactl`) | `brew install lima` | the Linux VMs that become k8s nodes |
| `kind` *(no longer required)* | — | retired; kept only in history |
| `kubectl` | `brew install kubectl` | talking to the cluster |
| `docker` CLI | comes with colima/Rancher | building + saving images |

36 GB RAM is comfortable (the VMs use ~8 GB total + colima ~8 GB for builds).

## 1. The corporate-CA requirement

**Skip this on a home/unrestricted network.** On a network that TLS-intercepts
`registry.k8s.io` (e.g. Netskope), kubeadm cannot pull its control-plane images
unless the VMs trust the intercepting CA. Provide the CA chain here (kept **out of
git**):

```bash
mkdir -p ~/.movieverse-ca
# Export the CA chain that signs registry.k8s.io's presented cert.
# On macOS the corp CA is usually in the System keychain:
security find-certificate -a -c "<your-corp-CA-substring>" -p /Library/Keychains/System.keychain \
  > ~/.movieverse-ca/corp-ca.pem
# Verify it actually validates the intercepted leaf:
echo | openssl s_client -connect registry.k8s.io:443 -servername registry.k8s.io 2>/dev/null \
  | openssl x509 > /tmp/leaf.pem
openssl verify -CAfile ~/.movieverse-ca/corp-ca.pem /tmp/leaf.pem    # want: /tmp/leaf.pem: OK
```

The lima template mounts `~/.movieverse-ca` into each VM and runs
`update-ca-certificates` before any pull. See
[OPERATIONS.md → Environment constraints](OPERATIONS.md#environment-constraints--workarounds)
for the full story (why `docker.io` works but `registry.k8s.io` doesn't, etc.).

## 2. Start the Docker engine (colima)

colima provides a Linux Docker daemon used **only to build the app images**
(the cluster itself uses containerd inside the VMs).

```bash
colima start --runtime docker
docker info >/dev/null && echo "docker ready"
```

> colima may log a `k3s.service failed` error on start — that's its built-in
> Kubernetes, which we don't use. The Docker engine still comes up fine.

## 3. Provision the cluster

```bash
./kubeadm/cluster-up.sh
```

This creates 4 lima VMs and bootstraps Kubernetes (idempotent — safe to re-run):

1. starts `mv-cp` + `mv-w1/2/3` from `kubeadm/lima-k8s-node.yaml`
2. discovers the control-plane IP on the `user-v2` network
3. `kubeadm init` (pod CIDR `10.244.0.0/16`, apiserver cert SAN `127.0.0.1`)
4. installs **Flannel** CNI
5. joins the 3 workers (`kubeadm token create --print-join-command`)
6. labels `mv-w1/2` `tier=general`, labels+taints `mv-w3` `tier=database`
7. writes a host kubeconfig to `~/.kube/kubeadm-mv.conf` (server → `127.0.0.1:6443`)

Verify:

```bash
export KUBECONFIG=$HOME/.kube/kubeadm-mv.conf
kubectl get nodes -L tier     # all Ready; mv-w3 = database
```

## 4. Build & load the app images

kubeadm has no `kind load`, so images are built on the host (colima) and imported
into each worker's containerd:

```bash
./kubeadm/load-images.sh
```

This builds `movieverse-backend:latest` and `movieverse-frontend:latest` (the
frontend with `VITE_SERVER_URL=http://localhost:8080/api`), `docker save`s them to
a tar, and `ctr -n k8s.io images import`s the tar on `mv-w1/2/3`.

> Re-run this whenever you change `backend/` or `frontend/`.

## 5. Deploy the app

```bash
./kubeadm/deploy.sh
```

Which:
1. installs **local-path-provisioner** (`k8s/local/local-path-provisioner.yaml`)
   and a default `standard` **StorageClass** (kubeadm ships none),
2. applies the **`local` Kustomize overlay** (namespaces, RBAC, config/secrets,
   Postgres StatefulSet, app Deployments, HPA/PDB, migration Job, host-less
   Ingress),
3. applies the **edge-proxy**,
4. waits for Postgres, the backend, and the frontend to roll out.

Verify:

```bash
kubectl -n movieverse get pods -o wide
# postgres-0 on mv-w3; backend pods spread across mv-w1/mv-w2
```

## 6. Access the app

```bash
kubectl -n movieverse port-forward svc/edge-proxy 8080:80
open http://localhost:8080
```

Smoke-test the full path (write → session → read against PostgreSQL):

```bash
BASE=http://localhost:8080
curl -fsS $BASE/api/health                                  # {"status":"ok"}
curl -fsS -c /tmp/cj -H 'Content-Type: application/json' \
  -d '{"username":"me@example.com","password":"pw123456","displayName":"Me"}' \
  $BASE/api/register
curl -fsS -b /tmp/cj $BASE/api/auth/check                   # returns the user
```

## 7. Observability

All images are on docker.io (reachable everywhere); the namespaces already exist:

```bash
kubectl apply -f k8s/monitoring/prometheus.yaml -f k8s/monitoring/grafana.yaml
kubectl apply -f k8s/logging/loki.yaml -f k8s/logging/promtail.yaml

kubectl -n monitoring port-forward svc/grafana 3000:3000     # http://localhost:3000 (admin/admin)
kubectl -n monitoring port-forward svc/prometheus 9090:9090  # http://localhost:9090
```

In Grafana: the **MovieVerse Overview** dashboard, and **Explore → Loki** with
`{namespace="movieverse"}` for logs.

## 8. Optional add-ons

This cluster *can* pull from `registry.k8s.io` (CA-trusted), so unlike the retired
kind setup it can run:

```bash
# metrics-server -> HPA reports real CPU/memory (kubelet certs are self-signed)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl -n movieverse get hpa movieverse-backend    # now shows cpu/mem %, not <unknown>

# real ingress-nginx (the host-less Ingress then routes the app)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.2/deploy/static/provider/baremetal/deploy.yaml
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8081:80   # http://localhost:8081

# Vault (secrets-management demo, dev mode)
kubectl apply -f k8s/vault/vault-dev.yaml

# GitOps with ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd patch cm argocd-cm --type merge \
  -p '{"data":{"kustomize.buildOptions":"--load-restrictor LoadRestrictionsNone"}}'
kubectl apply -f k8s/argocd/application.yaml         # set repoURL to your fork first
```

> `raw.githubusercontent.com` is sometimes DNS-blocked on the corp network; if a
> `kubectl apply -f https://raw...` fails to resolve, retry later or fetch from a
> reachable mirror. This is why `local-path-provisioner` is **vendored** in-repo.

## 9. Tear down

```bash
./kubeadm/down.sh         # delete all 4 lima VMs
colima stop               # stop the build engine (optional)
```

## 10. What each script does

| Script | Action |
|--------|--------|
| `kubeadm/cluster-up.sh` | provision VMs + `kubeadm init` + CNI + join + label/taint + host kubeconfig |
| `kubeadm/load-images.sh` | build app images (colima), `docker save`, `ctr import` onto workers |
| `kubeadm/deploy.sh` | storage (local-path + `standard` SC) + app (`local` overlay) + edge-proxy |
| `kubeadm/etcd-backup.sh` | `etcdctl snapshot save` of the real etcd via the control-plane pod |
| `kubeadm/down.sh` | `limactl delete` all VMs |

After a host reboot/sleep, see
[OPERATIONS.md → Recovering after host sleep](OPERATIONS.md#recovering-after-host-sleep).
