FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/cli ./packages/cli

RUN pnpm -r build

# ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/cli/package.json ./packages/cli/

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /build/packages/core/dist ./packages/core/dist
COPY --from=build /build/packages/cli/dist ./packages/cli/dist

# Non-root user
USER node

ENTRYPOINT ["node", "/app/packages/cli/dist/main.js"]
