# Anti-Dino

## Requirements

- Bun 1.4 — `mise install` picks it up from `mise.toml`
- [Varlock](https://varlock.dev) comes with `bun install`; run it as `bunx varlock ...`

## Getting started

Env vars are declared in `.env.schema`. Secrets live in
[Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/) and
are referenced from the schema by id, so the only secret you hold locally is a
machine account access token. Shared development defaults are committed in
`.env.development`; create a gitignored `.env.local` with the values that are
yours alone:

```bash
cat > .env.local <<'EOT'
BITWARDEN_ACCESS_TOKEN=<machine account token>
PUBLIC_URL=<public URL of your tunnel>
ADMIN_CHAT_ID=<your Telegram chat id>
EOT
```

```bash
bun install
bunx varlock load   # validates .env.local against the schema, masks secrets
bun run dev
```

Tests never touch Bitwarden: `.env.test` overrides the secrets with placeholders
and the access token is optional there.

Varlock is wired as a Bun preload (`bunfig.toml`), so `bun run`, `bun test`
and `bun --watch` load and validate the env automatically. Tests use the
committed `.env.test`. Use `bunx varlock run -- <cmd>` when you also want
secrets redacted from piped output.

## Scripts

- `bun run dev` — server with hot reload
- `bun run start` — server
- `bun run build` — compile to a single binary at `dist/server`
- `bun run typecheck` — `tsc --noEmit`
- `bun test`

## Docker

The image compiles the app to a single binary and runs it on a distroless base
(no shell, no Bun runtime). Env is resolved on the host by Varlock and passed
to the container via `compose.yaml`. The binary embeds Varlock and validates that
env against `.env.schema` on boot, refusing to start on a bad config. The SQLite
database lives in the `anti-dino-data` volume.

```bash
bunx varlock run -- docker compose up --build -d
docker compose logs -f
docker compose stop
```

The build cross-compiles for the target architecture, so a multi-arch image
(x86_64 and ARM64) can be produced from any host without emulation:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/anti-dino --push .
```
