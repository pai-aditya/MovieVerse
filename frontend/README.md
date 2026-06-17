# MovieVerse Frontend

React 18 + Vite + Tailwind CSS single-page app. Dev server on port **5173**; in
production it's built to static files and served by **nginx**.

## Run locally

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/
npm run preview    # preview the production build
npm run lint       # ESLint (max-warnings 0)
```

The dev server calls the backend directly at `VITE_SERVER_URL`
(default `http://localhost:5555`).

## Configuration — `VITE_SERVER_URL`

The backend base URL is **baked into the JS bundle at build time** (Vite inlines
`import.meta.env.*`). It is defined in `src/components/Constants.jsx`:

```js
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5555";
```

There is **no runtime config** — to point the SPA at a different API you rebuild
the image with a new build arg:

```bash
docker build --build-arg VITE_SERVER_URL=http://localhost:8080/api -t movieverse-frontend:latest .
```

In the Kubernetes setup the SPA is served same-origin behind the edge-proxy, so
it's built with `VITE_SERVER_URL=http://localhost:8080/api` (see
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)).

## Structure

```
src/
├── App.jsx                 Router config, auth check on mount, sidebar nav
├── main.jsx                React entry
├── components/
│   ├── Constants.jsx       SERVER_URL and shared constants
│   ├── Sidebar*.jsx        conditional nav (logged-in vs anonymous)
│   └── ...                 cards, modals, spinners, etc.
└── pages/                  Home, Profile, Reviews, Watchlist, Lists, Community,
                            Login/Register, ReviewMovie, ListView, ...
```

- `App.jsx` calls `FetchUserData()` → `GET ${SERVER_URL}/auth/check` (credentials
  included) on mount; the result drives whether the sidebar shows login vs profile,
  and gates private routes.
- All API calls include `credentials: "include"` so the session cookie flows.

## Docker

`Dockerfile` is a two-stage build: stage 1 runs `npm ci` + `vite build` (with the
`VITE_SERVER_URL` build-arg); stage 2 copies `dist/` into `nginx:alpine`.
`nginx.conf` adds an SPA fallback (`try_files ... /index.html`) so client-side
routes like `/profile` resolve, and long-caches hashed assets.
