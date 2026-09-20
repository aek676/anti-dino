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
instead of silently using production. The values that are yours alone go in a
gitignored `.env.local`, created from its template:

```bash
cp .env.local.example .env.local   # fill in your tunnel URL and Telegram chat id
bun install
bunx varlock load   # asks for the Bitwarden token once, then validates and masks secrets
bun run dev
```

### Tunnel for the Telegram webhook

The bot receives updates over a webhook, so Telegram needs a public HTTPS URL
that reaches your machine. On startup the app registers
`PUBLIC_URL + WEBHOOK_PATH` with Telegram, which means the tunnel has to be up
and `PUBLIC_URL` set before `bun run dev`. Run each in its own terminal so the
logs stay apart.

The default is a [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
quick tunnel, which needs no account and no domain:

```bash
# terminal 1
cloudflared tunnel --url http://localhost:3000
```

It prints a `https://<random-words>.trycloudflare.com` URL. Put it in
`.env.local` as `PUBLIC_URL` (no trailing slash), then:

```bash
# terminal 2
bun run dev
```

The URL changes every time cloudflared restarts, so update `PUBLIC_URL` and
restart the dev server when it does; leaving the tunnel running between dev
restarts avoids that. If `setWebhook` fails with "Failed to resolve host", the
new hostname has not propagated yet: wait a few seconds and save any file to
trigger a reload.

That is all you need. Optionally, if you have a domain in Cloudflare, a named
tunnel gives you a fixed URL so `PUBLIC_URL` is set once:

```bash
cloudflared tunnel login
cloudflared tunnel create anti-dino-dev
cloudflared tunnel route dns anti-dino-dev anti-dino-dev.<your-domain>
cloudflared tunnel run --url http://localhost:3000 anti-dino-dev
```

Any other tunnel (ngrok, Tailscale Funnel) works the same way, as long as it
gives you an HTTPS URL that forwards to port 3000.

The token never sits on disk in plaintext: Varlock swaps the `varlock(prompt)`
placeholder in `.env.local` for a `varlock(local:...)` value encrypted for your
machine, so it is useless anywhere else and unreadable to tools that open the
file. If you already have a plaintext `.env.local`, run
`bunx varlock encrypt --file .env.local` instead.

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

Everything production needs is committed in `.env.production`, so the only thing
the host supplies is the production `BITWARDEN_ACCESS_TOKEN`: either exported in
the environment, or in a `.env.local` holding that single line (the first load
then has to run in an interactive terminal so it can ask for the token). Keep
`PUBLIC_URL` and `ADMIN_CHAT_ID` out of that file, since `.env.local` overrides
`.env.production`. The first command fails if anything is missing or invalid, so
a bad config never reaches the container. Re-run it after changing `.env.schema`
or any `.env` value: the running container keeps the blob it started with. If
the plaintext blob should not sit in the environment, Varlock also accepts an
encrypted blob (`varlock:v1:...`) plus `_VARLOCK_ENV_KEY`.

The build cross-compiles for the target architecture, so a multi-arch image
(x86_64 and ARM64) can be produced from any host without emulation:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/anti-dino --push .
```
