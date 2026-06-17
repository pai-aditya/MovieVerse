#!/usr/bin/env bash
# Provision a multi-node kubeadm cluster on macOS using lima VMs (no sudo).
#   1 control-plane + 3 workers (2 general + 1 tainted "database" node),
#   Flannel CNI, host kubeconfig pointed through lima's auto-forwarded apiserver.
#
# Prereqs: limactl, kubectl, and a corporate CA bundle at ~/.movieverse-ca/corp-ca.pem
# (only needed on networks that TLS-intercept registry.k8s.io; see kubeadm/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/kubeadm/lima-k8s-node.yaml"
export LIMA_HOME="${LIMA_HOME:-$HOME/.lima}"
K8S_VERSION="v1.31.0"
POD_CIDR="10.244.0.0/16"   # matches Flannel's default
WORKERS=(mv-w1 mv-w2 mv-w3)

echo "==> Creating VMs (control-plane + ${#WORKERS[@]} workers)"
limactl list --format '{{.Name}}' | grep -qx mv-cp || \
  limactl start --name=mv-cp --tty=false "$TEMPLATE"
for w in "${WORKERS[@]}"; do
  limactl list --format '{{.Name}}' | grep -qx "$w" || \
    limactl start --name="$w" --tty=false "$TEMPLATE"
done

# Discover the control-plane IP on the user-v2 network (assigned by DHCP/MAC).
CP_IP="$(limactl shell mv-cp -- ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1)"
echo "==> Control-plane IP: $CP_IP"

if ! limactl shell mv-cp -- test -f /etc/kubernetes/admin.conf; then
  echo "==> kubeadm init"
  limactl shell mv-cp -- sudo kubeadm init \
    --apiserver-advertise-address="$CP_IP" \
    --pod-network-cidr="$POD_CIDR" \
    --apiserver-cert-extra-sans=127.0.0.1 \
    --kubernetes-version="$K8S_VERSION"

  echo "==> kubeconfig for the in-VM user + Flannel CNI"
  limactl shell mv-cp -- bash -c 'mkdir -p $HOME/.kube && sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config && sudo chown $(id -u):$(id -g) $HOME/.kube/config'
  limactl shell mv-cp -- kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
fi

echo "==> Joining workers"
JOIN="$(limactl shell mv-cp -- sudo kubeadm token create --print-join-command)"
for w in "${WORKERS[@]}"; do
  if ! limactl shell "$w" -- test -f /etc/kubernetes/kubelet.conf; then
    echo "    join $w"
    limactl shell "$w" -- sudo $JOIN
  fi
done

echo "==> Labelling + tainting nodes (2 general, 1 database)"
limactl shell mv-cp -- kubectl label node lima-mv-w1 lima-mv-w2 tier=general workload=app --overwrite
limactl shell mv-cp -- kubectl label node lima-mv-w3 tier=database workload=data --overwrite
limactl shell mv-cp -- kubectl taint node lima-mv-w3 dedicated=database:NoSchedule --overwrite

echo "==> Writing host kubeconfig (~/.kube/kubeadm-mv.conf -> 127.0.0.1:6443)"
mkdir -p "$HOME/.kube"
limactl shell mv-cp -- sudo cat /etc/kubernetes/admin.conf > "$HOME/.kube/kubeadm-mv.conf"
sed -i '' "s#server: https://$CP_IP:6443#server: https://127.0.0.1:6443#" "$HOME/.kube/kubeadm-mv.conf"

echo
echo "==> Cluster ready. Use it with:"
echo "      export KUBECONFIG=\$HOME/.kube/kubeadm-mv.conf"
limactl shell mv-cp -- kubectl wait --for=condition=Ready node --all --timeout=180s
limactl shell mv-cp -- kubectl get nodes -L tier
