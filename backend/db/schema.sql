-- MovieVerse relational schema (PostgreSQL).
-- Idempotent: safe to run on every boot and from the Kubernetes migration Job.
-- Replaces the previous MongoDB embedded-document model with normalised tables.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  google_id     TEXT,
  photos        TEXT,
  secret        TEXT,
  password_hash TEXT,
  salt          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    BIGINT  NOT NULL,
  rating      INTEGER,
  review_body TEXT,
  movie_title TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one review per movie per user (matches the old upsert-on-resubmit behaviour)
  UNIQUE (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    BIGINT  NOT NULL,
  movie_title TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lists (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS list_movies (
  id          SERIAL PRIMARY KEY,
  list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  movie_id    BIGINT  NOT NULL,
  movie_title TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_user      ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user    ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_user        ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_list_movies_list  ON list_movies(list_id);
