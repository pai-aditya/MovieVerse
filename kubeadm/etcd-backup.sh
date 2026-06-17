#!/usr/bin/env bash
# CKA staple: snapshot the REAL etcd of the kubeadm cluster (the etcd static pod
# on the control-plane). Saves to ./backups/etcd-snapshot-<ts>.db on the host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kubeadm-mv.conf}"
ETCD_POD="etcd-lima-mv-cp"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ROOT/backups"

echo "==> Taking etcd snapshot via $ETCD_POD"
kubectl -n kube-system exec "$ETCD_POD" -- sh -c '
  ETCDCTL_API=3 etcdctl \
    --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key \
    snapshot save /tmp/etcd-snapshot.db'

kubectl -n kube-system cp "$ETCD_POD:/tmp/etcd-snapshot.db" "$ROOT/backups/etcd-snapshot-$TS.db"
echo "==> Saved backups/etcd-snapshot-$TS.db"
kubectl -n kube-system exec "$ETCD_POD" -- sh -c '
  ETCDCTL_API=3 etcdctl --write-out=table snapshot status /tmp/etcd-snapshot.db' 2>/dev/null || true
