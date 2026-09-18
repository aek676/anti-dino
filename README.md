# Anti-Dino

## Requirements

- Bun 1.4 — `mise install` picks it up from `mise.toml`
- [Varlock](https://varlock.dev) comes with `bun install`; run it as `bunx varlock ...`

## Getting started

Env vars are declared in `.env.schema`. Secrets live in
[Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/) and
are referenced from the schema by id, so the only secret you hold locally is a
machine account access token. Shared defaults are committed per environment in
`.env.development` and `.env.production`, each pointing at its own Telegram bot.
The schema has no bot on purpose, so a missing environment file fails validation
instead of silently using production. Create the gitignored files with the values
that are yours alone:

```bash
# Loaded in every environment
cat > .env.local <<'EOT'
BITWARDEN_ACCESS_TOKEN=<machine account token>
EOT

# Loaded only in development, so the tunnel never ends up in a production load
cat > .env.development.local <<'EOT'
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
(no shell, no Bun runtime, no Varlock CLI). Varlock runs on the host instead: it
resolves and validates the whole config once, fetching the Bitwarden secrets with
`BITWARDEN_ACCESS_TOKEN`, and hands the container the result in `__VARLOCK_ENV`.
The binary only loads that blob, so the Bitwarden token never reaches the
runtime. The SQLite database lives in the `anti-dino-data` volume.

```bash
export __VARLOCK_ENV="$(NODE_ENV=production bunx varlock load --format json-full --compact)"
docker compose up --build -d
docker compose logs -f
docker compose stop
```

It reads `.env.production` plus a gitignored `.env.production.local` holding the
production `PUBLIC_URL` and `ADMIN_CHAT_ID`. The first command fails if anything
is missing or invalid, so a bad config never reaches the container. Re-run it
after changing `.env.schema` or any `.env` value: the running container keeps
the blob it started with. If the plaintext
blob should not sit in the environment, Varlock also accepts an encrypted blob
(`varlock:v1:...`) plus `_VARLOCK_ENV_KEY`.

The build cross-compiles for the target architecture, so a multi-arch image
(x86_64 and ARM64) can be produced from any host without emulation:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/anti-dino --push .
```
