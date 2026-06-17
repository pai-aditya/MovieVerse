# Decisions & Journey

The *why* behind MovieVerse's design, and the story of how it got here. This is
also the project's institutional memory — every non-obvious choice, dead end, and
gotcha is recorded so the knowledge survives.

- [The arc of the project](#the-arc-of-the-project)
- [Decision log](#decision-log)
- [Bugs found and fixed along the way](#bugs-found-and-fixed-along-the-way)
- [Constraints that shaped everything](#constraints-that-shaped-everything)

---

## The arc of the project

MovieVerse started as a conventional MERN-ish app (React + Express + **MongoDB**,
sessions in memory, deployed to assorted PaaS hosts). The goal became turning it
into a **DevOps / CKA portfolio piece**. The journey, in order:

1. **Re-platform the app to be cloud-native.** Migrated MongoDB → PostgreSQL,
   modularized the backend, moved sessions into the DB, and added health/readiness/
   metrics endpoints + Dockerfiles.
2. **Explored AWS EKS**, then **rejected it on cost** and committed to a fully
   self-hosted, open-source, zero-cost stack.
3. **Built the Kubernetes layer** (manifests, Kustomize, monitoring, logging,
   Vault, ArgoCD) and ran it on a local **kind** cluster.
4. **Replaced kind with a real `kubeadm` cluster** (the CKA-aligned way), retiring
   kind entirely. This is the current state.
5. **Hardened + documented**: metrics-server/ingress-nginx/Vault add-ons, grouped
   commits, and this docs set.

## Decision log

### D1 — MongoDB → PostgreSQL
**Why:** the data is inherently relational (users ↔ reviews ↔ lists ↔ list_movies),
and a relational schema with foreign keys + `ON DELETE CASCADE` models it honestly.
It also demonstrates schema design and migrations — better portfolio signal than
embedded documents.
**How:** `backend/db/schema.sql` (idempotent), `pg` driver, a `query()` helper, and
mapper functions that re-emit the old Mongo `_id`/camelCase JSON shapes so the
**React frontend did not have to change**. Review submit became an upsert
(`ON CONFLICT (user_id, movie_id) DO UPDATE`).

### D2 — Sessions in PostgreSQL (`connect-pg-simple`)
**Why:** in-memory sessions pin a user to one process and break with >1 replica.
Storing sessions in the DB lets the backend scale horizontally behind a Service —
which is the whole reason to run multiple replicas in Kubernetes.

### D3 — No Docker Compose
**Why:** explicit project constraint — the showcase is Kubernetes, and Compose
would muddy that. Obsolete `docker-compose.yml` / Mongo helper scripts were
deleted.

### D4 — Self-hosted OSS, not AWS
**Why:** an EKS build was costed at ~$150–210/month even optimized (EKS control
plane + NAT gateway are the big line items). For a portfolio that needs to run
indefinitely at zero cost, self-hosted Kubernetes + OSS equivalents win:
**Vault** (not AWS Secrets Manager), **Loki** (not CloudWatch), **local-path**
(not EBS), **edge-proxy/ingress-nginx** (not ALB).

### D5 — kind first, then **kubeadm** (kind fully retired)
**Why kind initially:** fastest path to a multi-node cluster for building out the
manifests, and ideal for CI.
**Why switch to kubeadm:** kind hides exactly what the **CKA** tests — you never
run `kubeadm init/join`, manage kubelet/containerd/certs, touch static pods in
`/etc/kubernetes/manifests`, or back up real etcd. A hand-bootstrapped kubeadm
cluster is the authentic CKA artifact, so kind was removed completely (its config,
scripts, and the kind-based CI e2e workflow).

### D6 — lima `user-v2` networking (not `socket_vmnet`)
**Why:** multi-node kubeadm needs VM-to-VM connectivity (workers ↔ apiserver). On
macOS the common path, `socket_vmnet`, requires **sudo/root**. lima's `user-v2`
network gives each VM a distinct, mutually-reachable `192.168.104.0/24` IP with
**no sudo** — which made the whole multi-node-on-a-Mac approach viable. IPs are
stable by MAC (cp=.1, gw=.2, workers=.3/.4/.5).

### D7 — Flannel (not Calico)
**Why:** Flannel's default pod network is `10.244.0.0/16`, which exactly matches
`--pod-network-cidr` (zero edits), it's lightweight for 2 GB nodes, and its images
are on docker.io. Trade-off: Flannel **does not enforce NetworkPolicies**, so
`k8s/namespaces/network-policies.yaml` is valid-but-not-enforced unless you swap in
Calico. Documented as such.
> Note: Calico's default pod CIDR (`192.168.0.0/16`) would have **collided** with
> the lima node subnet `192.168.104.0/24` — another reason Flannel + `10.244/16`
> was the clean choice.

### D8 — edge-proxy + `kubectl port-forward` access model
**Why:** two macOS/lima constraints make the "browse via Ingress on :80" path
painful locally: (a) lima doesn't forward **privileged host ports** (80) without
root, and (b) adding `movieverse.local` to `/etc/hosts` needs sudo. So the app is
exposed at `http://localhost:8080` by port-forwarding a small in-cluster nginx
(**edge-proxy**) that serves `/` (frontend) and `/api` (backend) **same-origin**
(so cookies work). The real `Ingress` + ingress-nginx still exist and work; the
edge-proxy is just the friction-free local path.

### D9 — Image delivery: `docker save` + `ctr import` (no `kind load`)
**Why:** kubeadm/containerd has no `kind load`. Images are built on the host
(colima docker), `docker save`d to a tar, and `ctr -n k8s.io images import`ed onto
each worker. `imagePullPolicy: IfNotPresent` then uses the local image (no
registry needed). colima is kept **only as the image builder**.

### D10 — Vendored `local-path-provisioner` + a `standard` StorageClass
**Why:** kind shipped a default StorageClass; **kubeadm ships none**, so PVCs stay
Pending. local-path-provisioner provides dynamic hostPath volumes. It's **vendored
in-repo** (`k8s/local/local-path-provisioner.yaml`) because
`raw.githubusercontent.com` (where its upstream manifest lives) is intermittently
DNS-blocked on the corp network. A default `standard` StorageClass points at it.

### D11 — Trust the corporate CA for `registry.k8s.io`
**Why:** the corp network (Netskope) **TLS-intercepts `registry.k8s.io`** but
passes `docker.io` through untouched. kubeadm pulls control-plane images from
registry.k8s.io, so the VMs must trust the intercepting CA chain (Coupa
intermediate → Netskope root). The CA bundle lives at `~/.movieverse-ca/corp-ca.pem`
(**never committed** — it identifies the employer) and is mounted into the VMs.

### D12 — Kustomize `--load-restrictor LoadRestrictionsNone`
**Why:** the kustomize base references topical sibling directories
(`../../app`, `../../database`, …) which is far more browsable than one flat
`base/` folder, but Kustomize's default load restrictor forbids reaching outside
the base dir. The flag relaxes that. ArgoCD gets the same via
`kustomize.buildOptions` in `argocd-cm`.

### D13 — Demo secrets committed in plaintext
**Why:** `k8s/app/secrets.yaml` holds obviously-fake values (`movieverse-supersecret`,
`change-me-session-secret`) for a throwaway local cluster, and Kustomize needs them
to build. The Vault component + comments document the real path (Vault Agent
Injector / Sealed Secrets / External Secrets). Real secrets (the corp CA) are kept
out of the repo via `.gitignore`.

### D14 — CI uses kind-free validation only
**Why:** a kubeadm/lima cluster can't run on standard GitHub-hosted runners (no
nested virtualization). The kind-based end-to-end CI was removed with kind. CI now
does image build + Trivy scan and **kubeconform** manifest validation; end-to-end
is exercised locally via `kubeadm/`.

### D15 — Commit history authored solely "Aditya Pai"
Work was committed in 5 logical commits on `feat/devops-platform-kubeadm`, authored
`Aditya Pai <pai.aditya2011@gmail.com>` (personal email, matching the personal
repo) with no co-author trailers. Pushing required switching `gh` to the personal
account and adding the `workflow` token scope (the branch touches `.github/workflows/`).

## Bugs found and fixed along the way

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Backend pods never created (`FailedCreate`) | The `wait-for-postgres` init container requested `25m/32Mi`, **below the LimitRange minimum** (`50m/64Mi`) | Raised the init container requests to `50m/64Mi` in `k8s/app/backend.yaml` |
| Postgres PVC stuck Pending; provisioner `ProvisioningFailed` | Hand-authored local-path ClusterRole was missing `pods: create/delete` (the provisioner spawns a helper pod per volume) | Added the `pods create/delete` rule in `k8s/local/local-path-provisioner.yaml` |
| `kubeadm init` preflight error | `conntrack` (and `socat`/`ethtool`) not installed on the VM | Added them to the apt install in `kubeadm/lima-k8s-node.yaml` |
| Promtail `CrashLoopBackOff` ("too many open files") | Host inotify limits too low for tailing all pod logs | Raised `fs.inotify.max_user_*` sysctls (in the lima template for kubeadm; was a manual `colima ssh` fix on kind) |
| ingress-nginx never Ready on kind | its `registry.k8s.io` images couldn't be pulled (Netskope) | worked around with the docker.io edge-proxy on kind; on kubeadm the CA trust makes ingress-nginx work |

## Constraints that shaped everything

These are environment facts (not choices) that drove many decisions above. Full
detail in [OPERATIONS.md](OPERATIONS.md#environment-constraints--workarounds):

- **`registry.k8s.io` is TLS-intercepted** (Netskope); `docker.io` is not.
- **`raw.githubusercontent.com` is intermittently DNS-blocked**; `github.com`
  release assets and `docker.io` are reachable.
- **lima `vz` VMs stop on host sleep**, and gvproxy DNS breaks on resume — the
  cluster must be restarted (IPs persist).
- **macOS lima** won't forward privileged ports without root, and `/etc/hosts`
  needs sudo — hence the `localhost:8080` port-forward access model.
