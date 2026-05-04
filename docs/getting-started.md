# Getting started

This guide takes you from "fresh clone" to "first PR" in about 15 minutes.

## 1. Prerequisites

- **Node.js 20+** (the project ships a `.replit` pinning `nodejs-20`).
- **PostgreSQL 14+** — local install, Docker, or a managed instance
  (Neon, Supabase, Replit's built-in DB, etc.).
- A WebGL2-capable browser. WebGPU is used when available; the engine
  falls back to WebGL2 automatically — see
  [`BabylonEngine.ts`](../client/src/game/BabylonEngine.ts).

## 2. Install dependencies

```bash
npm install
```

The repo uses npm (not pnpm/yarn) so `package-lock.json` is the source of
truth.

## 3. Configure environment variables

Create a `.env` file at the repo root (or export inline) with at least:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
SESSION_SECRET="some-long-random-string"
PORT="5000"
```

| Variable | Required | Used by |
|---|---|---|
| `DATABASE_URL` | ✅ | [`server/db.ts`](../server/db.ts) — Drizzle pg pool |
| `SESSION_SECRET` | ✅ | [`server/auth.ts`](../server/auth.ts) — `express-session` |
| `PORT` | ❌ (defaults to 5000) | [`server/index.ts`](../server/index.ts) |
| `NODE_ENV` | ❌ | switches Vite middleware vs. static `dist/` |
| `REPLIT_DEV_DOMAIN`, `REPL_ID` | auto, on Replit only | informational |

> **Never** commit secrets. The Replit env-secrets system manages them
> for the hosted environment.

## 4. Push the database schema

The project uses **Drizzle Kit** with `db:push` (no manual migrations):

```bash
npm run db:push
```

If the push reports a destructive change you actually want, force it:

```bash
npm run db:push -- --force
```

The schema lives in [`shared/schema.ts`](../shared/schema.ts). For deeper
detail see [`reference/database-schema.md`](reference/database-schema.md)
and [`how-to/modify-the-database.md`](how-to/modify-the-database.md).

## 5. Start the dev server

```bash
npm run dev
```

This runs [`server/index.ts`](../server/index.ts) under `tsx`, which:

1. Boots Express on `PORT`.
2. Mounts the multiplayer WebSocket server at `/ws`
   ([`server/multiplayer.ts`](../server/multiplayer.ts)).
3. In dev, mounts Vite in middleware mode, serving `client/index.html` and
   HMR over `/vite-hmr` ([`server/vite.ts`](../server/vite.ts)).

Open <http://localhost:5000>. You should see the **HEAVY WATER** login
screen. Register a callsign, log in, and click **PLAY** to drop into the
city.

## 6. Type-check before you commit

```bash
npm run check
```

This runs `tsc` with no emit. It is the de-facto CI check — the project
has no test suite (see [`contributing.md`](contributing.md)).

## 7. Build a production bundle

```bash
npm run build
npm start
```

`npm run build` invokes [`script/build.ts`](../script/build.ts), which
emits `dist/public/` for the static client and `dist/index.cjs` for the
Express server. `npm start` runs the bundled server with `NODE_ENV=production`.

## What's next

- Skim [`architecture.md`](architecture.md) for the 30,000-ft view.
- Open [`repository-structure.md`](repository-structure.md) and find the
  file for whatever you want to change.
- Pick a how-to from [`how-to/`](how-to/) and follow it end-to-end.

If anything in this page is wrong on your machine, file a PR or update
this doc directly — that is the highest-leverage contribution a new
developer can make.
