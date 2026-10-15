# One image for the web app, the admin app and the migration/maintenance
# scripts. Built from the pnpm monorepo; no secrets are baked in — everything
# comes from environment variables at runtime.
FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Installed globally (not via corepack) so containers never download pnpm at start-up.
RUN npm install -g pnpm@10.28.0 && pnpm --version
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile
COPY . .
# Next.js reads env at runtime; the build only needs placeholders.
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app -d /app app
COPY --from=build --chown=app:app /app /app
RUN mkdir -p /data/storage && chown app:app /data/storage
USER app
ENV STORAGE_LOCAL_DIR=/data/storage
EXPOSE 3000 3001
# Default: the web app. docker-compose overrides the command for admin/migrate.
CMD ["pnpm", "--filter", "@cba/web", "start"]
