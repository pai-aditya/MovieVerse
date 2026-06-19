#!/usr/bin/env bash
# Build + run the MovieVerse Jenkins controller on the host (colima docker).
# Jenkins is reachable at a FIXED port: http://localhost:8080  (agents: 50000).
# No docker-compose — a single, explicit `docker run` (project constraint).
#
# Required env (export before running; kept out of git):
#   GHCR_USER       GitHub username (ghcr owner)
#   GHCR_PAT        GitHub PAT with write:packages
#   ADMIN_PASSWORD  Jenkins admin password                              [default: admin]
#   KUBECONFIG      host kubeconfig with cluster access  [default: ~/.kube/kubeadm-mv.conf]
#                   Used ONCE here to mint the jenkins-deployer kubeconfig that the
#                   pipeline's 'Deploy preview' stage uses to register Applications.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="movieverse-jenkins"
IMAGE="movieverse-jenkins:latest"

: "${GHCR_USER:?export GHCR_USER (your GitHub username)}"
: "${GHCR_PAT:?export GHCR_PAT (PAT with write:packages)}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kubeadm-mv.conf}"

# --- Build the jenkins-deployer kubeconfig the pipeline mounts -----------------
# The container reaches the lima-forwarded apiserver at host.docker.internal:6443
# (TLS skipped — the apiserver cert has no SAN for that host). Auth is the
# least-privilege jenkins-deployer SA token (see cicd/argocd/jenkins-deployer-rbac.yaml).
DEPLOYER_KCFG="$DIR/.jenkins-deployer.kubeconfig"   # gitignored; mounted read-only
echo "==> Minting jenkins-deployer kubeconfig (apply jenkins-deployer-rbac.yaml first)"
SA_TOKEN="$(kubectl -n argocd get secret jenkins-deployer-token -o jsonpath='{.data.token}' | base64 -d)"
[ -n "$SA_TOKEN" ] || { echo "jenkins-deployer-token has no token yet — run: kubectl apply -f $DIR/../argocd/jenkins-deployer-rbac.yaml"; exit 1; }
cat > "$DEPLOYER_KCFG" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: mv
    cluster:
      server: https://host.docker.internal:6443
      insecure-skip-tls-verify: true
users:
  - name: jenkins-deployer
    user:
      token: ${SA_TOKEN}
contexts:
  - name: mv
    context: { cluster: mv, user: jenkins-deployer, namespace: argocd }
current-context: mv
EOF
chmod 600 "$DEPLOYER_KCFG"

echo "==> Building $IMAGE"
CORP_CA="${HOME}/.movieverse-ca/corp-ca.pem"
if [ -f "$CORP_CA" ]; then
  cp "$CORP_CA" "$DIR/corp-ca.pem"
  docker build --build-arg CORP_CA=corp-ca.pem -t "$IMAGE" "$DIR"
  rm -f "$DIR/corp-ca.pem"
else
  docker build -t "$IMAGE" "$DIR"
fi

echo "==> (Re)starting $NAME"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume create movieverse_jenkins_home >/dev/null

# NOTE: runs as root so the container can use the mounted host docker socket
# (Docker-outside-of-Docker). Acceptable for a local single-user portfolio cluster.
docker run -d --name "$NAME" --restart unless-stopped -u root \
  --add-host=host.docker.internal:host-gateway \
  -p 8080:8080 -p 50000:50000 \
  -v movieverse_jenkins_home:/var/jenkins_home \
  -v "$DIR/casc.yaml":/var/jenkins_home/casc.yaml:ro \
  -v "$DEPLOYER_KCFG":/var/jenkins_home/.kube/config:ro \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e ADMIN_PASSWORD -e GHCR_USER -e GHCR_PAT \
  "$IMAGE"

cat <<EOF

==> Jenkins starting at http://localhost:8080   (admin / \$ADMIN_PASSWORD)
    The 'movieverse' multibranch job is seeded from casc.yaml and will scan
    every branch within ~2 min (or click "Scan Multibranch Pipeline Now").

    Tail logs:   docker logs -f $NAME
    Stop:        docker rm -f $NAME
EOF
