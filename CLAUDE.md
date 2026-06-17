# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MovieVerse is a full-stack movie discovery and social platform. Users can browse movies via The Movie DB API, write and view reviews, maintain watchlists, and create custom movie lists. The app uses Passport.js for authentication (supporting both Google OAuth and username/password).

**Tech Stack:**
- **Backend:** Node.js + Express, running on port 5555
- **Frontend:** React 18 + Vite + Tailwind CSS, running on port 5173
- **Database:** PostgreSQL (via the `pg` driver)
- **Deployment:** Kubernetes — multi-node **kubeadm** cluster (lima VMs on macOS) with Prometheus/Grafana, Loki/Promtail, ArgoCD, and Kustomize. See `kubeadm/README.md` (cluster) and `k8s/README.md` (manifests).

## Architecture

### Backend Structure

The backend (`backend/`) is split into a few modules:

- `index.js` — Express app, Passport auth setup, all ~30 routes, startup logic.
- `db.js` — `pg` connection pool, `query()` helper, `initSchema()`, `checkConnection()`.
- `db/schema.sql` — Idempotent relational schema (run on boot and by the migration Job).
- `migrate.js` — Standalone migration runner (`npm run migrate`, used by the K8s Job).
- `metrics.js` — `prom-client` registry + Express middleware exposed at `/metrics`.

1. **Relational schema** (replaces the old Mongo embedded-document model):
   - `users`, `reviews`, `watchlist`, `lists`, `list_movies` — proper foreign keys with `ON DELETE CASCADE`.
   - Sessions are stored in a `session` table via `connect-pg-simple` (enables multi-replica scaling).

2. **Authentication:** Passport.js with two strategies
   - Google OAuth (optional): Requires `CLIENT_ID`, `CLIENT_SECRET` env vars.
   - Local username/password: `passport-local` + `crypto.pbkdf2` hashing (salt + hash stored on the `users` row).

3. **API Routes:** ~30 endpoints grouped by feature
   - `/auth/*` — Login/logout/Google callback/auth check
   - `/review/*` — Submit (upsert), fetch, check existence, delete reviews
   - `/watchlist/*` — Add/remove/fetch movies
   - `/lists/*` — Create lists, add movies to lists, fetch list data
   - `/health` (liveness), `/ready` (readiness, checks DB), `/metrics` (Prometheus)

**Important:** API responses preserve the original Mongo shapes — integer PKs are
serialized as `_id` strings and columns are mapped to camelCase (`movieID`,
`reviewBody`, nested `movies` arrays) so the existing frontend works unchanged.
The mapper functions (`mapReview`, `mapMovie`, `mapList`, `mapUser`) live in `index.js`.

### Frontend Structure

React SPA with React Router. Key layout:
- `App.jsx` — Router config, auth check on mount, sidebar navigation
- `pages/` — Page components (Home, Profile, Reviews, Watchlist, Lists, Community, Login/Register, etc.)
- `components/` — Reusable UI components and shared constants
- `components/Constants.jsx` — Central place for `SERVER_URL` and other constants

The sidebar (conditional rendering based on `showLoginButton` state) shows different nav items for logged-in vs. anonymous users.

## Development Commands

### Backend
```bash
cd backend
npm install
npm run dev              # Runs nodemon index.js (port 5555)
npm run build            # Just runs npm install
# Note: no test script defined
```

### Frontend
```bash
cd frontend
npm install
npm run dev              # Starts Vite dev server (port 5173)
npm run build            # Builds for production (vite build)
npm run lint             # ESLint check (js,jsx) with max-warnings=0
npm run preview          # Preview production build locally
```

## Environment Setup

Backend requires `.env` in `/backend` (copy from `.env.example`):
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=movieverse
# or a single DATABASE_URL=postgresql://...
SESSION_SECRET=change-me
COOKIE_SECURE=false           # set true only behind HTTPS
CLIENT_URL=http://localhost:5173
SERVER_URL=http://localhost:5555
PORT=5555
CLIENT_ID=                    # optional Google OAuth
CLIENT_SECRET=
```

If `CLIENT_ID` / `CLIENT_SECRET` are missing, Google OAuth is disabled but username/password login still works. The schema is created automatically on startup (idempotent), or via `npm run migrate`.

### Kubernetes

All manifests live under `k8s/` (organized by topic: `app/`, `database/`, `monitoring/`, `logging/`, etc.) with a Kustomize base + `dev`/`prod`/`local` overlays. Because the base references sibling directories, Kustomize builds require `--load-restrictor LoadRestrictionsNone`.

The cluster is a real **kubeadm** cluster on macOS (4 lima VMs: 1 control-plane + 2 general workers + 1 tainted database worker, Flannel CNI, k8s v1.31). Scripts in `kubeadm/` provision and drive it: `cluster-up.sh` → `load-images.sh` → `deploy.sh` (teardown: `down.sh`). Because there is no `kind load`, images are `docker save`d (built via colima) and `ctr ... images import`ed onto each worker; because kubeadm ships no default StorageClass, `k8s/local/local-path-provisioner.yaml` + a `standard` StorageClass are installed. The app is reached via `kubectl port-forward svc/edge-proxy 8080:80` (the `k8s/local/edge-proxy.yaml` nginx stands in for ingress). On networks that TLS-intercept `registry.k8s.io`, the VMs trust a corp CA from `~/.movieverse-ca/corp-ca.pem`. See `kubeadm/README.md`.

## Key Implementation Details

### Authentication Flow
- On app load, `FetchUserData()` calls `/auth/check` with credentials included
- Sets `user` state in App.jsx; if null, shows login button; else shows profile menu
- Login/register submit credentials to `/login` or `/register` endpoints
- Google OAuth redirects through `/auth/google` → Google → `/auth/google/callback` → redirects to `/profile`

### Data Storage
- Normalized relational tables with foreign keys (`ON DELETE CASCADE`) — see `db/schema.sql`.
- `reviews` has a `UNIQUE (user_id, movie_id)` constraint; review submission is an upsert (`ON CONFLICT ... DO UPDATE`).
- Helper functions `getReviews`/`getWatchlist`/`getLists`/`getFullUser` assemble the nested API shapes.

### API Patterns
- `req.isAuthenticated()` (or the `ensureAuth` middleware) gates private routes.
- Most endpoints return `{ success: boolean, message: string }` JSON.
- Review/watchlist endpoints use `movie_id` as the key for lookups and deletions.
- Route registration order matters: literal paths (e.g. `/watchlist/getList`) are registered before the catch-all `/watchlist/:movieID`.

## Notes for Contributors

1. **Config:** Backend reads `/backend/.env` locally; in K8s, config comes from a ConfigMap (`backend-config`) and Secrets (`db-credentials`, `app-secrets`). Frontend needs only `VITE_SERVER_URL` (baked at build time, defaults in `Constants.jsx`).

2. **CORS:** Backend allows origin from `CLIENT_URL` with credentials. In-cluster the SPA and API are same-origin (`movieverse.local` + `/api`) so cookies stay first-party.

3. **ESLint:** Frontend runs with strict linting (`max-warnings 0`). Any lint errors block `npm run lint`.

4. **Schema changes:** Edit `db/schema.sql` (keep it idempotent). It runs on boot and via the migration Job / `npm run migrate`.

5. **Sessions:** Stored in PostgreSQL via `connect-pg-simple`, so the backend can scale to multiple replicas.

6. **Readiness vs liveness:** `/health` never touches the DB (so transient DB outages don't restart pods); `/ready` gates traffic on DB reachability.

## Common Workflows

- **Add a new API endpoint:** Add a route handler in `backend/index.js` using the `query()` helper and a mapper for the response shape.
- **Change the schema:** Edit `backend/db/schema.sql`; it's applied idempotently on startup.
- **Add frontend page:** Create a file in `frontend/src/pages/`, import/export in `App.jsx`, add a route.
- **Deploy to Kubernetes:** `kubeadm/cluster-up.sh` → `kubeadm/load-images.sh` → `kubeadm/deploy.sh` (details in `kubeadm/README.md`).
