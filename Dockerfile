# syntax=docker/dockerfile:1
# Production image: Fastify API that also serves the built React app on one port.

FROM node:22-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Build ------------------------------------------------------------------
FROM base AS build
# Tests are not run here, so skip downloading the in-memory MongoDB binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/server/prisma apps/server/prisma
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    SERVE_WEB=true \
    WEB_DIST_DIR=../web/dist \
    UPLOAD_DIR=./uploads

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/server
RUN mkdir -p uploads && chown -R node:node uploads
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Sync collections and indexes (documents are untouched), then start the server.
CMD ["sh", "-c", "../../node_modules/.bin/prisma db push --skip-generate && node dist/index.js"]
