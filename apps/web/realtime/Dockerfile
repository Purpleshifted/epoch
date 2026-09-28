FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules

# Render/일반 PaaS에서 PORT/HOST 사용
ENV PORT=3001
ENV HOST=0.0.0.0
ENV SOCKET_PATH=/socket
ENV CORS_ORIGINS=https://intersection-web.onrender.com,https://intersection-audio.onrender.com

EXPOSE 3001

CMD ["node", "dist/index.js"]


