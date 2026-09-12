FROM oven/bun:1.4.2-slim AS base

WORKDIR /app

FROM --platform=$BUILDPLATFORM base AS deps

COPY package.json bun.lock ./
RUN bun ci

FROM --platform=$BUILDPLATFORM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json .env.schema ./
COPY src ./src

ENV NODE_ENV=production
# TARGETARCH is amd64|arm64; bun names them x64|arm64.
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) arch=x64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && bun run "build:linux-$arch" \
    && mv "dist/server-linux-$arch" dist/server

RUN bunx varlock flatten --vendor-plugins \
    && mkdir -p /app/data

FROM gcr.io/distroless/base-debian13:nonroot AS runner

WORKDIR /app

COPY --from=builder /app/dist/server ./server
COPY --from=builder /app/.env-flat/ ./
COPY --from=builder --chown=65532:65532 /app/data ./data

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/anti-dino.sqlite

EXPOSE 3000

USER 65532:65532

ENTRYPOINT ["/app/server"]
