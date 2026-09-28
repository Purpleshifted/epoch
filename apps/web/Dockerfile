######## All-in-one build: Next.js (standalone) + Realtime (Socket.IO)

FROM node:24-alpine AS deps-web
WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && corepack prepare yarn@1.22.22 --activate \
    && yarn install --frozen-lockfile

FROM node:24-alpine AS deps-rt
WORKDIR /app/realtime
COPY realtime/package.json ./
# Use npm for realtime to avoid Corepack prepare issues in some environments
RUN npm install --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps-web /app/node_modules ./node_modules
COPY --from=deps-rt /app/realtime/node_modules ./realtime/node_modules
COPY . .
# Build Next (standalone) and realtime TypeScript
RUN corepack enable && corepack prepare yarn@1.22.22 --activate \
    && yarn build \
    && npm --prefix realtime run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy Next standalone output
COPY --from=build /app/.next/standalone ./web
COPY --from=build /app/.next/static ./web/.next/static
COPY --from=build /app/public ./web/public

# Copy realtime dist and node_modules
COPY --from=build /app/realtime/dist ./realtime/dist
COPY --from=deps-rt /app/realtime/node_modules ./realtime/node_modules

# Orchestrator script
COPY scripts/start-all.mjs ./scripts/start-all.mjs

EXPOSE 3000 3001
ENV WEB_PORT=3000 \
    WEB_HOST=0.0.0.0 \
    REALTIME_PORT=3001 \
    REALTIME_HOST=0.0.0.0 \
    NEXT_PUBLIC_WS_URL=http://localhost:3001/socket \
    NEXT_PUBLIC_NOISECRAFT_WS_URL=http://localhost:4000 \
    NEXT_PUBLIC_NOISECRAFT_PATCH_SRC=/public/examples/chord_spatial.ncft

CMD ["node", "/app/scripts/start-all.mjs"]
