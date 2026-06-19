#!/usr/bin/env bash
# MovieVerse — one-shot bring-up after a full teardown.
#
# Use this when you've run `kubeadm/down.sh` (deletes the lima VMs) and/or removed
# the Jenkins container, and want the whole CI/CD + GitOps stack back. It is
# idempotent — safe to re-run; each step skips work that's already done.
#
# What it does, in order (order matters):
#   1. kubeadm cluster on lima VMs            (kubeadm/cluster-up.sh)
#   2. local-path StorageClass 'standard'      (else every PVC hangs Pending)
#   3. ArgoCD (Helm) + NodePort service
#   4. GitOps bootstrap: AppProject + app-of-apps (shared Postgres, monitoring, …)
#   5. jenkins-deployer RBAC (least-priv SA Jenkins applies previews as)
#   6. Jenkins controller on the host          (cicd/jenkins/jenkins-up.sh)
#
# Per-branch preview apps are NOT created here — Jenkins creates them when it scans
# and builds each branch (within ~2 min of step 6, or click "Scan Multibranch
# Pipeline Now"). Each preview then lands at http://localhost:<port> (hostPort +
# lima auto-forward — see cicd/README.md), with the URL shown in the ArgoCD app.
#
# Required env:
#   GHCR_USER   GitHub username (ghcr owner)         e.g. pai-aditya
#   GHCR_PAT    GitHub classic PAT, write:packages
# Optional:
#   ADMIN_PASSWORD   Jenkins admin password           [default: admin]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/kubeadm-mv.conf}"
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
step "0/6  Preflight"
for bin in limactl kubectl helm docker; do
  command -v "$bin" >/dev/null || die "'$bin' not found on PATH"
done
: "${GHCR_USER:?set GHCR_USER (your GitHub username)}"
: "${GHCR_PAT:?set GHCR_PAT (PAT with write:packages)}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
echo "  kubeconfig: $KUBECONFIG"

# ---------------------------------------------------------------------------
step "1/6  kubeadm cluster (lima VMs)"
# cluster-up.sh is idempotent: it skips VMs that already exist and writes the host
# kubeconfig to ~/.kube/kubeadm-mv.conf (server -> 127.0.0.1:6443 via lima).
"$ROOT/kubeadm/cluster-up.sh"
kubectl wait --for=condition=Ready node --all --timeout=180s

# ---------------------------------------------------------------------------
step "2/6  Storage: local-path provisioner + default 'standard' StorageClass"
# kubeadm ships no default StorageClass. Without this, postgres PVCs stay Pending,
# postgres-0 never schedules, and the preview db-ensure hook waits forever.
kubectl apply -f "$ROOT/k8s/local/local-path-provisioner.yaml"
kubectl apply -f - <<'EOF'
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
kubectl -n local-path-storage rollout status deploy/local-path-provisioner --timeout=120s

# ---------------------------------------------------------------------------
step "3/6  ArgoCD (Helm)"
helm repo add argo https://argoproj.github.io/argo-helm >/dev/null 2>&1 || true
helm repo update argo >/dev/null
helm upgrade --install argocd argo/argo-cd -n argocd --create-namespace \
  --set 'configs.cm.kustomize\.buildOptions=--load-restrictor LoadRestrictionsNone' \
  --set-string 'configs.cm.accounts\.admin=apiKey\, login'
kubectl apply -f "$ROOT/cicd/argocd/server-nodeport.yaml"
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s

# ---------------------------------------------------------------------------
step "4/6  GitOps bootstrap (AppProject + app-of-apps)"
kubectl apply -f "$ROOT/cicd/argocd/appproject.yaml"
kubectl apply -f "$ROOT/cicd/argocd/app-of-apps.yaml"
echo "  ArgoCD will now sync shared Postgres, monitoring, logging, vault."

# ---------------------------------------------------------------------------
step "5/6  Jenkins deployer RBAC (least-privilege SA)"
kubectl apply -f "$ROOT/cicd/argocd/jenkins-deployer-rbac.yaml"
# Wait for the token controller to populate the SA token (jenkins-up.sh reads it).
echo -n "  waiting for jenkins-deployer-token"
for _ in $(seq 1 30); do
  kubectl -n argocd get secret jenkins-deployer-token \
    -o jsonpath='{.data.token}' 2>/dev/null | grep -q . && { echo " — ready"; break; }
  echo -n "."; sleep 2
done

# ---------------------------------------------------------------------------
step "6/6  Jenkins controller (host container)"
# Builds the image (with kubectl), mints+mounts the deployer kubeconfig, runs on :8080.
"$ROOT/cicd/jenkins/jenkins-up.sh"

# ---------------------------------------------------------------------------
ADMIN_PW="$(kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || true)"
cat <<EOF

$(printf '\033[1;32m==> Stack is up.\033[0m')

  Jenkins   http://localhost:8080            (admin / $ADMIN_PASSWORD)
  ArgoCD    https://localhost:30443          (admin / ${ADMIN_PW:-<see argocd-initial-admin-secret>})
            kubectl -n argocd port-forward svc/argocd-server 30443:443

Next:
  • One-time, if you haven't: make the ghcr packages public
    (GitHub → Packages → movieverse-backend/-frontend → make Public).
  • Jenkins scans the repo within ~2 min and builds every branch; each build
    applies its preview Application. Watch them appear:
      kubectl -n argocd get applications
  • Each preview is then reachable at http://localhost:<port> (no port-forward) —
    the exact URL is shown on the Application page in ArgoCD ("Preview URL").

  Always talk to this cluster with:  export KUBECONFIG=$KUBECONFIG
EOF
