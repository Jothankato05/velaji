# NCIHAP API — production image (the backend only; the web/ SPA deploys
# separately as static assets).
#
# Multi-stage: build with the full toolchain, then ship a lean runtime with
# production dependencies only.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
# Omit dev deps (typescript, tsx, mongodb-memory-server) — production connects
# to a real MONGODB_URI and runs the compiled JS.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Run as the non-root user the base image already provides.
USER node

EXPOSE 4100
# The container is healthy for traffic only once /ready returns 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
