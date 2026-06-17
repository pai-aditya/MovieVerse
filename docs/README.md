# MovieVerse Documentation

Start here, in order:

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the whole system fits together
   (app tiers, data model, auth/sessions, the kubeadm cluster, networking,
   observability, GitOps/CI, and an end-to-end request trace).
2. **[DEPLOYMENT.md](DEPLOYMENT.md)** — bring everything up from scratch
   (prereqs, corp-CA setup, cluster provisioning, image loading, deploy, add-ons).
3. **[OPERATIONS.md](OPERATIONS.md)** — run it day-to-day: environment constraints
   & workarounds, recovering after host sleep, host access, common ops, etcd
   backup, and a troubleshooting cheatsheet.
4. **[DECISIONS.md](DECISIONS.md)** — *why* it's built this way: the full journey
   (MongoDB→Postgres, EKS→self-hosted, kind→kubeadm), the decision log, the bugs
   found and fixed, and the environment constraints that shaped it all.
5. **[CKA-MAPPING.md](CKA-MAPPING.md)** — how the project maps to the CKA exam
   domains (portfolio talking points).

Component-level docs live next to the code:
- [../backend/README.md](../backend/README.md) — API, schema, auth, env vars
- [../frontend/README.md](../frontend/README.md) — SPA structure, build, config
- [../k8s/README.md](../k8s/README.md) — the Kubernetes manifests, by topic
- [../kubeadm/README.md](../kubeadm/README.md) — provisioning the cluster

And [../CLAUDE.md](../CLAUDE.md) is guidance for AI assistants working in the repo.
