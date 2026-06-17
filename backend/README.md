# MovieVerse Backend

Node.js + Express API (ES modules) backed by PostgreSQL. Runs on port **5555**.

See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how it fits the whole
system; this README is the backend-specific reference.

## Modules

| File | Responsibility |
|------|----------------|
| `index.js` | Express app, Passport auth, all routes, startup, row→JSON mappers |
| `db.js` | `pg` connection pool, `query(text, params)`, `initSchema()`, `checkConnection()` |
| `db/schema.sql` | Idempotent relational schema (source of truth) |
| `migrate.js` | Standalone schema runner — `npm run migrate` (used by the K8s migration Job) |
| `metrics.js` | `prom-client` registry + Express middleware for `/metrics` |
| `Dockerfile` | `node:20-alpine`, non-root, `node index.js` |

## Run locally

Needs a reachable PostgreSQL (matching your env below). The schema is created
automatically on first boot.

```bash
npm install
npm run dev        # nodemon index.js → http://localhost:5555
# or
npm run migrate    # apply schema only, then exit
npm start          # node index.js
```

Spin up a throwaway Postgres quickly:
```bash
docker run --rm -d --name mv-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=movieverse postgres:16-alpine
```

## Environment variables

Copy `../.env.example` → `.env`.

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `5555` | |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `localhost`/`5432`/`postgres`/`postgres`/`movieverse` | individual DB settings |
| `DATABASE_URL` | — | alternative to the `DB_*` vars |
| `SESSION_SECRET` | `TheMovieVerseProject` | signs session cookies |
| `COOKIE_SECURE` | `false` | set `true` behind HTTPS (enables `Secure` + `SameSite=None`) |
| `CLIENT_URL` | — | browser origin (CORS + OAuth redirects) |
| `SERVER_URL` | — | this server's public URL (OAuth callback) |
| `CLIENT_ID` / `CLIENT_SECRET` | — | optional Google OAuth; blank = local auth only |

## Data model

`db/schema.sql`:

```
users(id, username UNIQUE, email, display_name, google_id, photos, secret,
      password_hash, salt, created_at)
reviews(id, user_id→users, movie_id, rating, review_body, movie_title, created_at,
        UNIQUE(user_id, movie_id))
watchlist(id, user_id→users, movie_id, movie_title, created_at)
lists(id, user_id→users, title, description, created_at)
list_movies(id, list_id→lists, movie_id, movie_title, created_at)
session   -- managed by connect-pg-simple
```

All FKs use `ON DELETE CASCADE`. Indexes on every FK column.

## API response shapes (Mongo-compatibility)

The frontend predates the SQL migration and expects MongoDB-style JSON. Mapper
functions in `index.js` translate rows accordingly — **keep these stable**:

- `mapReview` → `{ _id, movieID, rating, reviewBody, movieTitle }`
- `mapMovie`  → `{ _id, movieID, movieTitle }`
- `mapList`   → `{ _id, title, description, movies: [mapMovie...] }`
- `mapUser`   → `{ _id, username, email, displayName, photos, reviews, watchlist, lists }`

Integer PKs are serialized as **`_id` strings**.

## Routes

Operational:
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | liveness (no DB) |
| GET | `/ready` | readiness (DB reachable + schema applied) |
| GET | `/metrics` | Prometheus metrics |

Auth:
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/register` | create local user, log in |
| POST | `/login` | local login (passport-local) |
| GET | `/auth/check` | current user (full nested shape) or 401 |
| GET | `/auth/logout` | log out, redirect to `CLIENT_URL` |
| GET | `/auth/google`, `/auth/google/callback` | Google OAuth (if configured) |

Reviews / Watchlist / Lists (auth-gated where it mutates the current user):
| Method | Path |
|--------|------|
| POST | `/review/submit` (upsert) |
| GET | `/review/getreviews`, `/review/getreviews/:userID` |
| GET | `/review/reviewData/:movieID` |
| DELETE | `/review/delete/:movieID` |
| POST | `/watchlist/addMovie` |
| GET | `/watchlist/getList`, `/watchlist/user/:userID`, `/watchlist/:movieID` |
| DELETE | `/watchlist/delete/:movieID` |
| POST | `/lists/create`, `/lists/addMovie` |
| DELETE | `/lists/removeMovie`, `/lists/deleteList/:listID` |
| GET | `/lists/getLists`, `/lists/getLists/:userID`, `/lists/getList/:listID`, `/lists/getList/:listID/:userID` |

> **Route order matters:** literal paths (e.g. `/watchlist/getList`) are registered
> before the catch-all `/watchlist/:movieID` so they aren't shadowed.

## Auth & sessions

- `passport-local` verifies passwords with `crypto.pbkdf2` (310k iterations, sha256)
  using a timing-safe compare; salt + hash are stored on the `users` row.
- `serializeUser` stores only `user.id`; `deserializeUser` reloads the row.
- Sessions persist in the `session` table (`connect-pg-simple`) → the API scales
  to multiple replicas.

## Notes

- The app starts serving immediately and applies the schema with retries in the
  background; `/ready` flips to 200 once the DB is reachable (`dbReady`).
- No automated tests yet (`npm test` is a placeholder) — a known gap.
