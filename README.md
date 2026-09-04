# Anti-Dino

## Requirements

- Bun 1.4 — `mise install` picks it up from `mise.toml`

## Getting started

```bash
cp .env.example .env.local   # then fill in the values
bun install
bun run dev
```

## Scripts

- `bun run dev` — server with hot reload
- `bun run start` — server
- `bun run build` — compile to a single binary at `dist/server`
- `bun run typecheck` — `tsc --noEmit`
- `bun test`

## Docker

The image compiles the app to a single binary and runs it on a distroless base
(no shell, no Bun runtime). Secrets come from `.env.local`; the SQLite database
lives in the `anti-dino-data` volume.

```bash
docker compose up --build -d
docker compose logs -f
docker compose stop
```

The build cross-compiles for the target architecture, so a multi-arch image
(x86_64 and ARM64) can be produced from any host without emulation:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/anti-dino --push .
```
