FROM oven/bun:1.4.4-alpine
USER root
RUN apk add --no-cache su-exec
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY server ./server
COPY scripts ./scripts

COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -eu
cd /app
# DOCKER_GID is the host docker group id for /var/run/docker.sock (mounted
# read-only). Running as bun:<gid> lets the unprivileged server read container
# state + log tails without running as root. Unset = no socket access.
if [ -n "${DOCKER_GID:-}" ]; then
  exec su-exec "bun:${DOCKER_GID}" bun server/index.ts
fi
exec su-exec bun:bun bun server/index.ts
EOF
RUN chmod 755 /entrypoint.sh
ENV NODE_ENV=production
ENV PORT=3101
ENV HOME=/tmp
EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3101/api/health | grep -q '"ok":true'

ENTRYPOINT ["/entrypoint.sh"]
