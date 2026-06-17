#!/usr/bin/env bash
# Deploy MovieVerse onto the kubeadm cluster (run after cluster-up.sh + load-images.sh).
# Uses the host kubeconfig written by cluster-up.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kubeadm-mv.conf}"
KUBECTL="kubectl"

echo "==> Storage: local-path-provisioner + default 'standard' StorageClass"
$KUBECTL apply -f "$ROOT/k8s/local/local-path-provisioner.yaml"
$KUBECTL apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
EOF
$KUBECTL -n local-path-storage rollout status deploy/local-path-provisioner --timeout=120s

echo "==> Application (local overlay) + edge-proxy"
$KUBECTL kustomize --load-restrictor LoadRestrictionsNone "$ROOT/k8s/kustomize/overlays/local" | $KUBECTL apply -f -
$KUBECTL apply -f "$ROOT/k8s/local/edge-proxy.yaml"

echo "==> Waiting for the stack"
$KUBECTL -n movieverse rollout status statefulset/postgres --timeout=180s
$KUBECTL -n movieverse rollout status deploy/movieverse-backend --timeout=180s
$KUBECTL -n movieverse rollout status deploy/movieverse-frontend --timeout=180s

cat <<'EOF'

==> Deployed. Browse the app:
      kubectl -n movieverse port-forward svc/edge-proxy 8080:80
      open http://localhost:8080
EOF
