FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/cli ./packages/cli

RUN pnpm -r build

# ──────────────────────────────────────────────
# Runtime: tsup bundles all deps into dist/main.js — no node_modules needed
FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=build /build/packages/cli/dist/main.js ./main.js

USER node

ENTRYPOINT ["node", "/app/main.js"]
