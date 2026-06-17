import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth20";
import connectPgSimple from "connect-pg-simple";
import crypto from "crypto";

import pool, { query, initSchema, checkConnection } from "./db.js";
import { register as metricsRegister, metricsMiddleware } from "./metrics.js";

dotenv.config();

const PORT = process.env.PORT || 5555;
const app = express();

// Behind an ingress/proxy in Kubernetes we must trust the proxy for secure
// cookies and correct client IPs.
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(metricsMiddleware);
app.use(
  cors({
    origin: `${process.env.CLIENT_URL}`,
    credentials: true,
  })
);

// Sessions are stored in PostgreSQL (connect-pg-simple) rather than in-memory so
// the backend can run as multiple horizontally-scaled replicas behind a Service.
const PgSession = connectPgSimple(session);
const cookieSecure = process.env.COOKIE_SECURE === "true";
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "TheMovieVerseProject",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      secure: cookieSecure,
      sameSite: cookieSecure ? "none" : "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

/* -------------------------------------------------------------------------- */
/* Auth helpers                                                               */
/* -------------------------------------------------------------------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 310000, 32, "sha256")
    .toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  if (!salt || !storedHash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256");
  const stored = Buffer.from(storedHash, "hex");
  return (
    candidate.length === stored.length &&
    crypto.timingSafeEqual(candidate, stored)
  );
}

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const { rows } = await query("SELECT * FROM users WHERE username = $1", [
        username,
      ]);
      const user = rows[0];
      if (!user) return done(null, false, { message: "Incorrect username" });
      if (!user.password_hash) {
        return done(null, false, { message: "Use Google sign-in for this account" });
      }
      if (!verifyPassword(password, user.salt, user.password_hash)) {
        return done(null, false, { message: "Incorrect password" });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// Only the user id lives in the session; the row is reloaded on each request.
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
    done(null, rows[0] || false);
  } catch (err) {
    done(err);
  }
});

const googleAuthEnabled = Boolean(
  process.env.CLIENT_ID && process.env.CLIENT_SECRET
);

async function findOrCreateGoogleUser(profile) {
  const email = profile._json.email;
  const googleId = profile.id;
  const existing = await query(
    "SELECT * FROM users WHERE google_id = $1 OR username = $2",
    [googleId, email]
  );
  if (existing.rows.length) return existing.rows[0];
  const inserted = await query(
    `INSERT INTO users (username, email, display_name, google_id, photos)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [email, email, profile.displayName, googleId, profile._json.picture]
  );
  return inserted.rows[0];
}

if (googleAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        callbackURL: `${process.env.SERVER_URL}/auth/google/callback`,
      },
      async function (accessToken, refreshToken, profile, callback) {
        try {
          const user = await findOrCreateGoogleUser(profile);
          return callback(null, user);
        } catch (err) {
          return callback(err);
        }
      }
    )
  );
} else {
  console.log(
    "Google OAuth disabled (CLIENT_ID / CLIENT_SECRET not set). Username/password login is still available."
  );
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
}

/* -------------------------------------------------------------------------- */
/* Row -> API shape mappers                                                   */
/* (preserve the old Mongo response shapes: `_id` strings + camelCase fields) */
/* -------------------------------------------------------------------------- */

const mapReview = (r) => ({
  _id: String(r.id),
  movieID: Number(r.movie_id),
  rating: r.rating,
  reviewBody: r.review_body,
  movieTitle: r.movie_title,
});

const mapMovie = (r) => ({
  _id: String(r.id),
  movieID: Number(r.movie_id),
  movieTitle: r.movie_title,
});

const mapList = (r, movies) => ({
  _id: String(r.id),
  title: r.title,
  description: r.description,
  movies: movies.map(mapMovie),
});

function mapUser(u, reviews, watchlist, lists) {
  return {
    _id: String(u.id),
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    photos: u.photos,
    reviews,
    watchlist,
    lists,
  };
}

async function getReviews(userId) {
  const { rows } = await query(
    "SELECT * FROM reviews WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  return rows.map(mapReview);
}

async function getWatchlist(userId) {
  const { rows } = await query(
    "SELECT * FROM watchlist WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  return rows.map(mapMovie);
}

async function getLists(userId) {
  const { rows } = await query(
    "SELECT * FROM lists WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  const lists = [];
  for (const row of rows) {
    const movies = await query(
      "SELECT * FROM list_movies WHERE list_id = $1 ORDER BY id",
      [row.id]
    );
    lists.push(mapList(row, movies.rows));
  }
  return lists;
}

async function getFullUser(id) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  if (!rows.length) return null;
  const [reviews, watchlist, lists] = await Promise.all([
    getReviews(id),
    getWatchlist(id),
    getLists(id),
  ]);
  return mapUser(rows[0], reviews, watchlist, lists);
}

/* -------------------------------------------------------------------------- */
/* Operational endpoints (Kubernetes probes + Prometheus)                     */
/* -------------------------------------------------------------------------- */

let dbReady = false;

// Liveness: process is up and serving. Does NOT touch the DB so a transient DB
// outage doesn't trigger pod restarts.
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Readiness: only route traffic once the schema is applied and the DB answers.
app.get("/ready", async (req, res) => {
  if (!dbReady) return res.status(503).json({ status: "initializing" });
  try {
    await checkConnection();
    res.status(200).json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "db unreachable" });
  }
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

/* -------------------------------------------------------------------------- */
/* Auth routes                                                                */
/* -------------------------------------------------------------------------- */

app.get("/auth/google", (req, res, next) => {
  if (!googleAuthEnabled) {
    return res
      .status(501)
      .send("Google sign-in is not configured on this server. Please use username/password login.");
  }
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!googleAuthEnabled) return res.redirect(`${process.env.CLIENT_URL}/login`);
    passport.authenticate("google", { failureRedirect: "/auth/login/failed" })(
      req,
      res,
      next
    );
  },
  (req, res) => res.redirect(`${process.env.CLIENT_URL}/profile`)
);

app.get("/auth/login/failed", (req, res) => {
  res.status(401).json({ error: true, message: "Log in failure" });
});

app.get("/auth/logout", (req, res) => {
  req.logOut(function (err) {
    if (err) console.log("logout error: " + err);
    res.redirect(`${process.env.CLIENT_URL}`);
  });
});

app.post("/register", async (req, res) => {
  const { username, password, displayName } = req.body;
  try {
    const exists = await query("SELECT id FROM users WHERE username = $1", [
      username,
    ]);
    if (exists.rows.length) {
      return res.status(500).json({ success: false, message: "Registration failed" });
    }
    const { salt, hash } = hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (username, email, display_name, password_hash, salt)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [username, username, displayName, hash, salt]
    );
    req.login(rows[0], (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: "Registration failed" });
      }
      res.status(200).json({ success: true, message: "Registration successful" });
    });
  } catch (err) {
    console.log("register error: " + err.message);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user) => {
    if (err) return res.status(500).json({ success: false, message: "Login failed" });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    req.login(user, (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ success: false, message: "Login failed" });
      }
      res.status(200).json({ success: true, message: "Login successful" });
    });
  })(req, res, next);
});

app.get("/auth/check", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const user = await getFullUser(req.user.id);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

app.post("/review/submit", ensureAuth, async (req, res) => {
  const { id: movieID, rating, reviewBody, movieTitle } = req.body;
  try {
    await query(
      `INSERT INTO reviews (user_id, movie_id, rating, review_body, movie_title)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, movie_id)
       DO UPDATE SET rating = EXCLUDED.rating,
                     review_body = EXCLUDED.review_body,
                     movie_title = EXCLUDED.movie_title`,
      [req.user.id, movieID, rating, reviewBody, movieTitle]
    );
    res.status(200).json({ success: true, message: "Review saved successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Review cannot be saved, something went wrong" });
  }
});

app.get("/review/getreviews", ensureAuth, async (req, res) => {
  try {
    res.status(200).json({ reviews: await getReviews(req.user.id) });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/review/getreviews/:userID", async (req, res) => {
  try {
    res.status(200).json({ reviews: await getReviews(req.params.userID) });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/review/reviewData/:movieID", ensureAuth, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM reviews WHERE user_id = $1 AND movie_id = $2",
      [req.user.id, req.params.movieID]
    );
    if (rows.length) {
      res.status(200).json({ error: false, success: true, review: mapReview(rows[0]) });
    } else {
      res.status(200).json({ error: false, success: false, message: "Review not found" });
    }
  } catch (err) {
    res.status(500).json({ error: true, message: "Internal server error" });
  }
});

app.delete("/review/delete/:movieID", ensureAuth, async (req, res) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM reviews WHERE user_id = $1 AND movie_id = $2",
      [req.user.id, req.params.movieID]
    );
    if (rowCount) {
      res.status(200).json({ success: true, message: "Review deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Review with the provided movieID not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Review deletion failed" });
  }
});

/* -------------------------------------------------------------------------- */
/* Watchlist                                                                  */
/* -------------------------------------------------------------------------- */

app.post("/watchlist/addMovie", ensureAuth, async (req, res) => {
  const { id: movieID, movieTitle } = req.body;
  try {
    await query(
      "INSERT INTO watchlist (user_id, movie_id, movie_title) VALUES ($1, $2, $3)",
      [req.user.id, movieID, movieTitle]
    );
    res.status(200).json({ success: true, message: "Movie added to watchlist successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Movie cannot be added to watchlist, something went wrong" });
  }
});

app.get("/watchlist/getList", ensureAuth, async (req, res) => {
  try {
    res.status(200).json({ watchlist: await getWatchlist(req.user.id) });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/watchlist/user/:userID", async (req, res) => {
  try {
    res.status(200).json({ watchlist: await getWatchlist(req.params.userID) });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/watchlist/delete/:movieID", ensureAuth, async (req, res) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM watchlist WHERE user_id = $1 AND movie_id = $2",
      [req.user.id, req.params.movieID]
    );
    if (rowCount) {
      res.status(200).json({ success: true, message: "Movie removed from watchlist successfully" });
    } else {
      res.status(404).json({ success: false, message: "Movie with the provided movieID not found in watchlist" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Movie removal from watchlist failed" });
  }
});

// Keep the catch-all param route last so it doesn't shadow the literal routes.
app.get("/watchlist/:movieID", ensureAuth, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id FROM watchlist WHERE user_id = $1 AND movie_id = $2",
      [req.user.id, req.params.movieID]
    );
    if (rows.length) {
      res.status(200).json({ error: false, success: true, message: "movie is found in the user's watchlist" });
    } else {
      res.status(200).json({ error: false, success: false, message: "Movie not found in user's watchlist" });
    }
  } catch (err) {
    res.status(500).json({ error: true, message: "Internal server error" });
  }
});

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

app.post("/lists/create", ensureAuth, async (req, res) => {
  const { listName, listDescription } = req.body;
  try {
    await query(
      "INSERT INTO lists (user_id, title, description) VALUES ($1, $2, $3)",
      [req.user.id, listName, listDescription]
    );
    res.status(200).json({ success: true, message: "List created successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "List cannot be created, something went wrong" });
  }
});

app.post("/lists/addMovie", ensureAuth, async (req, res) => {
  const { selectedItems, movieID, movieTitle } = req.body;
  try {
    const listIDs = Object.keys(selectedItems || {}).filter((k) => selectedItems[k]);
    for (const listID of listIDs) {
      const owned = await query(
        "SELECT id FROM lists WHERE id = $1 AND user_id = $2",
        [listID, req.user.id]
      );
      if (owned.rows.length) {
        await query(
          "INSERT INTO list_movies (list_id, movie_id, movie_title) VALUES ($1, $2, $3)",
          [listID, movieID, movieTitle]
        );
      }
    }
    res.status(200).json({ success: true, message: "Movie added to selected lists successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add movie to selected lists" });
  }
});

app.delete("/lists/removeMovie", ensureAuth, async (req, res) => {
  const { movie_id: movieID, listID } = req.body;
  try {
    const owned = await query(
      "SELECT id FROM lists WHERE id = $1 AND user_id = $2",
      [listID, req.user.id]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ success: false, message: "List not found" });
    }
    const { rowCount } = await query(
      "DELETE FROM list_movies WHERE list_id = $1 AND movie_id = $2",
      [listID, movieID]
    );
    if (rowCount) {
      res.status(200).json({ success: true, message: "Movie removed from list successfully" });
    } else {
      res.status(404).json({ success: false, message: "Movie not found in the list" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to remove movie from list" });
  }
});

app.delete("/lists/deleteList/:listID", ensureAuth, async (req, res) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM lists WHERE id = $1 AND user_id = $2",
      [req.params.listID, req.user.id]
    );
    if (rowCount) {
      res.status(200).json({ success: true, message: "List deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "List not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete list" });
  }
});

app.get("/lists/getLists", ensureAuth, async (req, res) => {
  try {
    res.status(200).json({ success: true, lists: await getLists(req.user.id) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching lists" });
  }
});

app.get("/lists/getLists/:userID", async (req, res) => {
  try {
    res.status(200).json({ success: true, lists: await getLists(req.params.userID) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching lists" });
  }
});

app.get("/lists/getList/:listID", ensureAuth, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM lists WHERE id = $1 AND user_id = $2",
      [req.params.listID, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "List not found" });
    }
    const movies = await query(
      "SELECT * FROM list_movies WHERE list_id = $1 ORDER BY id",
      [rows[0].id]
    );
    res.status(200).json(mapList(rows[0], movies.rows));
  } catch (err) {
    res.status(500).json({ success: false, message: "Error finding list" });
  }
});

app.get("/lists/getList/:listID/:userID", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM lists WHERE id = $1 AND user_id = $2",
      [req.params.listID, req.params.userID]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "List not found" });
    }
    const movies = await query(
      "SELECT * FROM list_movies WHERE list_id = $1 ORDER BY id",
      [rows[0].id]
    );
    res.status(200).json(mapList(rows[0], movies.rows));
  } catch (err) {
    res.status(500).json({ success: false, message: "Error finding list" });
  }
});

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

app.get("/alldata", async (req, res) => {
  try {
    const { rows } = await query("SELECT id FROM users ORDER BY id");
    const data = [];
    for (const row of rows) data.push(await getFullUser(row.id));
    res.status(200).json({ data });
  } catch (err) {
    console.error("Error fetching entire database:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/", (req, res) => res.send("Welcome to MovieVerse"));

/* -------------------------------------------------------------------------- */
/* Startup                                                                    */
/* -------------------------------------------------------------------------- */

// Start serving immediately so the liveness probe passes; apply the schema with
// retries in the background and flip readiness on once the DB is reachable.
async function initWithRetry(retries = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await initSchema();
      dbReady = true;
      console.log("Database ready");
      return;
    } catch (err) {
      console.log(`Database not ready (attempt ${attempt}/${retries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error("Database never became ready; readiness probe will keep failing.");
}

app.listen(PORT, () => {
  console.log(`App is listening on port: ${PORT} at ${new Date()}`);
  initWithRetry();
});
