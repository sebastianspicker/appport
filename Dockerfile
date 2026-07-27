FROM node:24.18.0-alpine3.23 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/windows-client/package.json ./apps/windows-client/package.json
COPY packages/appport-contracts/package.json ./packages/appport-contracts/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24.18.0-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV APPPORT_SQLITE_PATH=/data/appport.sqlite
RUN addgroup --system --gid 1001 appport \
  && adduser --system --uid 1001 --ingroup appport appport \
  && mkdir -p /data \
  && chown appport:appport /data \
  && chmod 0700 /data
COPY --from=builder --chown=appport:appport /app/.next/standalone ./
COPY --from=builder --chown=appport:appport /app/.next/static ./.next/static
RUN chown -R root:root /app \
  && chmod -R a-w /app
USER appport
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/ready >/dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
