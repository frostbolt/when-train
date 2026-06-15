# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json vite.config.ts vite-env.d.ts index.html ./
COPY src ./src
COPY public ./public
# Build version (git short hash on the deploy host); baked into the bundle.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN npm run build

# ── Serve ─────────────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
