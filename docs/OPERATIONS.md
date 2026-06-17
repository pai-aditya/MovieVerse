# Operations Runbook

Day-2 operations, the environment quirks of this setup, and a troubleshooting
cheatsheet. Pairs with [DEPLOYMENT.md](DEPLOYMENT.md) (first-time bring-up).

- [Quick reference](#quick-reference)
- [Environment constraints & workarounds](#environment-constraints--workarounds)
- [Recovering after host sleep](#recovering-after-host-sleep)
- [Host access to the cluster](#host-access-to-the-cluster)
- [Common operations](#common-operations)
- [etcd backup & restore](#etcd-backup--restore)
- [Troubleshooting cheatsheet](#troubleshooting-cheatsheet)

---

## Quick reference

```bash
export PATH="/opt/homebrew/bin:$PATH"
export LIMA_HOME="$HOME/.lima"
export KUBECONFIG="$HOME/.kube/kubeadm-mv.conf"

limactl list                                  # VM status
kubectl get nodes -L tier                     # cluster nodes
kubectl get pods -A                           # everything
kubectl -n movieverse port-forward svc/edge-proxy 8080:80   # app → http://localhost:8080
```

The cluster's kube-context is **`kubeadm-mv.conf`** (server `https://127.0.0.1:6443`).
This machine's kubeconfig also contains **work AWS EKS contexts** — always pin
`KUBECONFIG`/`--context` so you never act on the wrong cluster.

## Environment constraints & workarounds

These are facts about the corporate laptop/network. They explain a lot of the
project's design (see [DECISIONS.md](DECISIONS.md)).

### `registry.k8s.io` is TLS-intercepted (Netskope); `docker.io` is not
- Probe: `echo | openssl s_client -connect registry.k8s.io:443 -servername registry.k8s.io 2>/dev/null | openssl x509 -noout -issuer`
  shows issuer `CN=ca.coupa-ts.goskope.com` (a **Netskope** intermediate, root
  `CN=certadmin, O=Netskope Inc.`). The same probe against `registry-1.docker.io`
  shows a real Amazon-issued cert — so docker.io is passed through untouched.
- **Consequence:** anything pulling from `registry.k8s.io` (kubeadm control-plane
  images, metrics-server, ingress-nginx) fails with `x509: certificate signed by
  unknown authority` unless the puller trusts the Netskope CA.
- **Fix:** trust the CA chain. Extract it (see [DEPLOYMENT.md](DEPLOYMENT.md#1-the-corporate-ca-requirement))
  to `~/.movieverse-ca/corp-ca.pem`; the lima template mounts it and runs
  `update-ca-certificates`. **Never commit this file** (it's in `.gitignore`).

### `raw.githubusercontent.com` is intermittently DNS-blocked
- Symptom: `dial tcp: lookup raw.githubusercontent.com ... no such host` (or i/o
  timeout). `github.com` **release assets** (e.g. Flannel, metrics-server) and
  `docker.io` work fine.
- **Consequence / fix:** don't depend on `raw.githubusercontent.com`. That's why
  `local-path-provisioner` is **vendored** in `k8s/local/`. If a
  `kubectl apply -f https://raw...` fails, retry later or vendor the manifest.

### lima `vz` VMs stop on host sleep
- macOS sleeping stops the VMs; on resume, lima's gvproxy **DNS forwarding breaks**
  (symptom: nodes can't resolve `registry-1.docker.io`, pods stuck `ImagePullBackOff`).
- **Fix:** restart the VMs (next section). IPs are preserved (assigned by MAC).

### No privileged ports / no `/etc/hosts` without sudo
- lima won't forward host port 80, and editing `/etc/hosts` needs sudo. Hence the
  app is reached via `kubectl port-forward ... 8080:80` rather than an ingress on
  `:80` / a `movieverse.local` hostname.

## Recovering after host sleep

```bash
export LIMA_HOME="$HOME/.lima"
for vm in mv-cp mv-w1 mv-w2 mv-w3; do limactl start "$vm"; done

export KUBECONFIG="$HOME/.kube/kubeadm-mv.conf"
kubectl get nodes                 # should return to Ready within ~30–60s
# IPs are stable; the cluster recovers on its own.

# Re-open any port-forwards you need (they die on sleep):
kubectl -n movieverse port-forward svc/edge-proxy 8080:80
```

If a node stays `NotReady` or pods stay `ImagePullBackOff` with DNS errors, the
gvproxy DNS didn't recover — fully restart that VM (`limactl stop <vm> && limactl start <vm>`).

## Host access to the cluster

The host kubeconfig is `~/.kube/kubeadm-mv.conf` with server
`https://127.0.0.1:6443`. Two ways the host reaches the apiserver:

1. **lima auto-forward (default):** lima forwards the guest's `6443` to the host's
   `127.0.0.1:6443` automatically once `mv-cp` is up. Usually just works.
2. **SSH tunnel (fallback)** if auto-forward isn't active:
   ```bash
   ssh -F ~/.lima/mv-cp/ssh.config -L 127.0.0.1:6443:192.168.104.1:6443 -N lima-mv-cp &
   ```

The apiserver cert was created with `--apiserver-cert-extra-sans=127.0.0.1`, so TLS
verifies against `127.0.0.1`.

To run kubectl **inside** the control-plane VM instead:
`limactl shell mv-cp -- kubectl get nodes` (ignore the harmless
`cd: /Users/... No such file or directory` line — lima trying to mirror the host cwd).

## Common operations

```bash
export KUBECONFIG="$HOME/.kube/kubeadm-mv.conf"

# logs
kubectl -n movieverse logs deploy/movieverse-backend -f
kubectl -n logging logs ds/promtail

# scale / autoscale
kubectl -n movieverse scale deploy/movieverse-backend --replicas=3
kubectl -n movieverse get hpa movieverse-backend          # needs metrics-server

# rollout / restart
kubectl -n movieverse rollout restart deploy/movieverse-backend
kubectl -n movieverse rollout status deploy/movieverse-backend

# database shell
kubectl -n movieverse exec -it postgres-0 -- psql -U movieverse -d movieverse

# resource usage (needs metrics-server)
kubectl top nodes ; kubectl top pods -n movieverse

# rebuild + reload app images after a code change
./kubeadm/load-images.sh && kubectl -n movieverse rollout restart deploy/movieverse-backend deploy/movieverse-frontend
```

## etcd backup & restore

```bash
./kubeadm/etcd-backup.sh        # snapshot real etcd → ./backups/etcd-snapshot-<ts>.db
```

The script `kubectl exec`s into the `etcd-lima-mv-cp` static pod and runs
`etcdctl snapshot save` with the kubeadm PKI certs, then copies the snapshot to the
host (`backups/` is git-ignored). Restore is the standard kubeadm flow
(`etcdctl snapshot restore` into a new data dir, repoint the etcd static pod) — a
classic CKA exercise.

## Troubleshooting cheatsheet

```bash
kubectl -n <ns> get pods -o wide
kubectl -n <ns> describe pod <pod>                 # Events: scheduling, probes, pulls
kubectl -n <ns> get events --sort-by=.lastTimestamp | tail -30
kubectl -n <ns> logs <pod> [-c <container>] [--previous]
```

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| Pod `Pending`, "unbound PVC" | no provisioner / SC | check `kubectl get sc` and `kubectl -n local-path-storage get pods` |
| `ImagePullBackOff` for `registry.k8s.io/*` | CA not trusted, or post-sleep DNS | verify CA in VM; restart VMs |
| `ImagePullBackOff` for app image | image not imported on that node | re-run `./kubeadm/load-images.sh` |
| Pod rejected, "minimum cpu/memory" | request below LimitRange `min` | raise the container's requests |
| `FailedScheduling` for postgres | taint/affinity mismatch | confirm `mv-w3` has `tier=database` + the taint |
| Promtail crash "too many open files" | inotify limits | template sets them; on a bare VM raise `fs.inotify.max_user_*` |
| HPA shows `<unknown>` | no metrics-server | install metrics-server (+ `--kubelet-insecure-tls`) |
| host `kubectl` connection refused | lima forward / tunnel down (sleep) | restart VMs; re-open SSH tunnel |
