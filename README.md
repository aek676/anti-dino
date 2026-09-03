# Anti-Dino

Bot de Telegram que vigila la agenda de Elvis en Fresha y avisa cuando se libera una hora.

## Requisitos

- Bun (ver `mise.toml`)

## Arranque

```bash
cp .env.example .env.local   # y rellena los valores
bun install
bun run dev
```

## Scripts

- `bun run dev` — servidor con recarga
- `bun run start` — servidor
- `bun run typecheck` — `tsc --noEmit`
- `bun test`

## Estructura

```
src/
  index.ts        servidor Elysia: webhook de Telegram + cron del vigilante
  config.ts       lectura y validación de variables de entorno
  bot/            comandos /start, /huecos, /parar (UC-1..3)
  fresha/         único cliente que habla con Fresha (UC-7)
  watcher/        comprobación periódica y avisos (UC-4..6)
  db/             SQLite (bun:sqlite): suscriptores y huecos conocidos
```
