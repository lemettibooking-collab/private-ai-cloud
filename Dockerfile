# AI-045.0: infrastructure hosting only; no coding worker or dispatch enablement.
FROM node:24.22.2-bookworm-slim AS base
RUN npm install --global npm@11.8.0 --no-audit --no-fund \
    && node --version | grep -Fx 'v24.22.2' \
    && npm --version | grep -E '^11\.8\.'
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
# Explicit source allowlist as well as .dockerignore: no host env, Git or credentials.
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY types ./types
COPY public ./public
COPY next.config.ts postcss.config.mjs tsconfig.json ./
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
# next start loads the existing TypeScript next.config.ts; retain its exact locked compiler.
COPY --from=build /app/node_modules/typescript ./node_modules/typescript
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json package-lock.json next.config.ts ./
# Only the small Node-only operator/health dependency closure, not the application sources.
COPY scripts/deployment ./scripts/deployment
COPY lib/deployment ./lib/deployment
COPY lib/db/postgres.ts lib/db/executor-start-transaction.ts ./lib/db/
COPY lib/contracts/runtime-operational-signals.ts ./lib/contracts/
COPY db/migrations ./db/migrations
RUN mkdir -p /app/.next/cache /home/node/.config/private-ai-cloud \
    && chown -R node:node /app/.next/cache /home/node/.config \
    && chmod 700 /home/node/.config/private-ai-cloud
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/deployment/health.mts", "ready"]
# Same Next.js production runtime as npm start. No migrations, seed or worker entrypoint.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
