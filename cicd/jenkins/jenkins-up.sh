#!/usr/bin/env bash
# Build + run the MovieVerse Jenkins controller on the host (colima docker).
# Jenkins is reachable at a FIXED port: http://localhost:8080  (agents: 50000).
# No docker-compose — a single, explicit `docker run` (project constraint).
#
# Required env (export before running; kept out of git):
#   GHCR_USER       GitHub username (ghcr owner)
#   GHCR_PAT        GitHub PAT with write:packages
#   ARGOCD_TOKEN    ArgoCD API token (for the pipeline's refresh step)  [optional]
#   ADMIN_PASSWORD  Jenkins admin password                              [default: admin]
#   ARGOCD_SERVER   host:port of argocd-server NodePort  [default: argocd.local:30443]
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="movieverse-jenkins"
IMAGE="movieverse-jenkins:latest"

: "${GHCR_USER:?export GHCR_USER (your GitHub username)}"
: "${GHCR_PAT:?export GHCR_PAT (PAT with write:packages)}"
export ARGOCD_TOKEN="${ARGOCD_TOKEN:-}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
export ARGOCD_SERVER="${ARGOCD_SERVER:-argocd.local:30443}"

echo "==> Building $IMAGE"
docker build -t "$IMAGE" "$DIR"

echo "==> (Re)starting $NAME"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume create movieverse_jenkins_home >/dev/null

# NOTE: runs as root so the container can use the mounted host docker socket
# (Docker-outside-of-Docker). Acceptable for a local single-user portfolio cluster.
docker run -d --name "$NAME" --restart unless-stopped -u root \
  -p 8080:8080 -p 50000:50000 \
  -v movieverse_jenkins_home:/var/jenkins_home \
  -v "$DIR/casc.yaml":/var/jenkins_home/casc.yaml:ro \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e ADMIN_PASSWORD -e GHCR_USER -e GHCR_PAT -e ARGOCD_TOKEN -e ARGOCD_SERVER \
  "$IMAGE"

cat <<EOF

==> Jenkins starting at http://localhost:8080   (admin / \$ADMIN_PASSWORD)
    The 'movieverse' multibranch job is seeded from casc.yaml and will scan
    every branch within ~2 min (or click "Scan Multibranch Pipeline Now").

    Tail logs:   docker logs -f $NAME
    Stop:        docker rm -f $NAME
EOF
