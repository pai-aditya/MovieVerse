#!/usr/bin/env bash
# Build the app images and import them into every worker's containerd.
# kubeadm has no `kind load`, so we build (via colima docker), `docker save`,
# then `ctr -n k8s.io images import` on each node.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LIMA_HOME="${LIMA_HOME:-$HOME/.lima}"
TAG="${1:-latest}"
WORKERS=(mv-w1 mv-w2 mv-w3)
# Same-origin URL the SPA calls (served via the edge-proxy port-forward on 8080).
API_URL="http://localhost:8080/api"

echo "==> Building images (colima docker context)"
docker build -t "movieverse-backend:$TAG" "$ROOT/backend"
docker build --build-arg VITE_SERVER_URL="$API_URL" -t "movieverse-frontend:$TAG" "$ROOT/frontend"

echo "==> Saving to tar"
TAR=/tmp/mv-images.tar
docker save "movieverse-backend:$TAG" "movieverse-frontend:$TAG" -o "$TAR"

echo "==> Importing into worker containerd (k8s.io namespace)"
for w in "${WORKERS[@]}"; do
  echo "    $w"
  limactl copy "$TAR" "$w:/tmp/mv-images.tar"
  limactl shell "$w" -- sudo ctr -n k8s.io images import /tmp/mv-images.tar
done
echo "==> Done."
