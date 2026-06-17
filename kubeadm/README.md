# MovieVerse on a kubeadm cluster (macOS, no cloud, no sudo)

This replaces the earlier `kind` setup with a **real, hand-bootstrapped Kubernetes
cluster** built with `kubeadm` — the CKA-aligned way: you provision the nodes,
init the control plane, install the CNI, and join the workers yourself.

## Topology

| VM | Role | Labels / taint |
|----|------|----------------|
| `mv-cp`  | control-plane | — |
| `mv-w1`  | worker | `tier=general` |
| `mv-w2`  | worker | `tier=general` |
| `mv-w3`  | worker | `tier=database` + taint `dedicated=database:NoSchedule` |

- **VMs:** Ubuntu 24.04 via **lima** (`vmType: vz`), 2 vCPU / 2 GiB each.
- **VM-to-VM networking:** lima's **`user-v2`** network — gives each VM a distinct
  `192.168.104.0/24` IP and lets them talk to each other **without sudo**
  (the usual `socket_vmnet` path needs root). This is what makes multi-node
  kubeadm possible on a Mac without admin rights.
- **CNI:** Flannel (`10.244.0.0/16`, matches `--pod-network-cidr`; docker.io images).
- **Runtime:** containerd with `SystemdCgroup=true`. **Kubernetes v1.31.**

## The corporate-CA requirement

This network (Netskope) **TLS-intercepts `registry.k8s.io`** and DNS-blocks
`raw.githubusercontent.com`. kubeadm pulls its control-plane images from
`registry.k8s.io`, so the VMs must trust the corporate CA:

```bash
# Extract your network's intercepting CA chain into the bundle the VMs mount:
mkdir -p ~/.movieverse-ca
# (chain that signs registry.k8s.io's presented cert; e.g. from the macOS keychain)
security find-certificate -a -c "<your-corp-CA-CN>" -p /Library/Keychains/System.keychain \
  > ~/.movieverse-ca/corp-ca.pem
```

The lima template mounts `~/.movieverse-ca` read-only and `update-ca-certificates`
trusts it before any pull. The bundle is **kept out of git** (it identifies the
employer). On an unrestricted network you can leave it empty.

## Usage

```bash
./kubeadm/cluster-up.sh        # create VMs, init, CNI, join, label/taint, write kubeconfig
./kubeadm/load-images.sh       # build app images + import into each worker's containerd
./kubeadm/deploy.sh            # storage + app + edge-proxy
export KUBECONFIG=$HOME/.kube/kubeadm-mv.conf
kubectl -n movieverse port-forward svc/edge-proxy 8080:80
open http://localhost:8080
./kubeadm/down.sh              # delete all VMs
```

## Access model

- **kubectl from the host:** the kubeconfig points at `https://127.0.0.1:6443`;
  lima auto-forwards the apiserver port from `mv-cp`. (cert has a `127.0.0.1` SAN.)
- **Browser:** `kubectl port-forward` the in-cluster `edge-proxy` to `localhost:8080`.
  The edge-proxy (a docker.io nginx) serves `/` → frontend and `/api` → backend,
  same-origin so session cookies work. (It stands in for ingress-nginx, mirroring
  the `local` overlay used previously.)

## Things specific to kubeadm vs kind

- **No `kind load`** → images are `docker save`d and `ctr ... images import`ed onto
  each node (`load-images.sh`).
- **No default StorageClass** → we install `local-path-provisioner` (vendored in
  `k8s/local/local-path-provisioner.yaml`, since `raw.githubusercontent.com` is
  blocked) and define a default `standard` StorageClass.
- **Real CKA surface:** `kubeadm init/join`, static pods in
  `/etc/kubernetes/manifests`, real etcd (`scripts/etcd-backup.sh` snapshots it),
  certs, kubelet on systemd.

## Optional add-ons (work here because registry.k8s.io is reachable via the CA)

```bash
# metrics-server (makes HPA report real CPU/memory; kubeadm kubelet certs are self-signed)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# ingress-nginx (baremetal provider); the local overlay's host-less Ingress then routes the app
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.2/deploy/static/provider/baremetal/deploy.yaml
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8081:80   # http://localhost:8081

# observability + secrets demo
kubectl apply -f k8s/monitoring/prometheus.yaml -f k8s/monitoring/grafana.yaml
kubectl apply -f k8s/logging/loki.yaml -f k8s/logging/promtail.yaml
kubectl apply -f k8s/vault/vault-dev.yaml
```

## Caveat: host sleep

`vz` VMs stop when macOS sleeps, and lima's gvproxy DNS breaks on resume. After a
sleep, restart them:

```bash
for vm in mv-cp mv-w1 mv-w2 mv-w3; do limactl start $vm; done
```

IPs are stable across restarts (assigned by MAC), so the cluster recovers cleanly.
