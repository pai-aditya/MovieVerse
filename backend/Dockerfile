# --- MovieVerse backend (Express + PostgreSQL) ---
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

# Run as the built-in non-root user
USER node

EXPOSE 5555

# `npm run dev` uses nodemon (not a dependency) — run node directly in containers
CMD ["node", "index.js"]
