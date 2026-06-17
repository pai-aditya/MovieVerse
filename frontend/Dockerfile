# --- MovieVerse frontend (React + Vite, served by nginx) ---

# Stage 1: build the static bundle
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Backend URL is baked into the bundle at build time.
# Override with: docker build --build-arg VITE_SERVER_URL=https://api.example.com
ARG VITE_SERVER_URL=http://localhost:5555
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
