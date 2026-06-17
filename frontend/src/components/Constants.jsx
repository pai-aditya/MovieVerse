// Backend base URL.
// Configurable at build time via VITE_SERVER_URL (Vite bakes env vars into the
// bundle during `vite build`). Falls back to localhost for plain `npm run dev`.
//
// Previous deployment targets (kept for reference):
// https://movieversebackend-yf41.onrender.com
// https://movie-verse-server-pied.vercel.app
// https://themovieverseserver.netlify.app/.netlify/functions/api
// https://themovieverse.cyclic.app
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5555";
