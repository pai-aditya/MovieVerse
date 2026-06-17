#!/usr/bin/env bash
# Tear down the kubeadm cluster (delete all lima VMs).
set -euo pipefail
export LIMA_HOME="${LIMA_HOME:-$HOME/.lima}"
for vm in mv-cp mv-w1 mv-w2 mv-w3; do
  limactl list --format '{{.Name}}' | grep -qx "$vm" && limactl delete -f "$vm" || true
done
echo "==> All kubeadm VMs deleted."
