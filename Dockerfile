FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json tsconfig.json ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY server ./server
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3101
EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3101/api/health | grep -q '"ok":true'

CMD ["bun", "run", "server/index.ts"]
