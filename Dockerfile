# Velaji — production image. Builds the API and the web SPA, then serves both
# from one origin: the SPA at /, the API at /api. One URL, no CORS to configure.
#
# Multi-stage: full toolchain in the build stages, lean runtime at the end.

# ---- build the API ----
FROM node:20-slim AS api-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- build the web SPA ----
FROM node:20-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
# Omit dev deps (typescript, tsx, mongodb-memory-server) — production connects
# to a real MONGODB_URI and runs the compiled JS.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api-build /app/dist ./dist
# app.ts looks for ../web-dist relative to dist/, i.e. /app/web-dist.
COPY --from=web-build /web/dist ./web-dist

# Run as the non-root user the base image already provides.
USER node

EXPOSE 4100
# The container is healthy for traffic only once /ready returns 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
