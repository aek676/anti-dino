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
- `bun run typecheck` — `tsc --noEmit`
- `bun test`
