# Deployment

Heavy Water deploys to **Replit Autoscale** (per `.replit`), but the
build is portable to any Node-friendly host (Render, Railway, Fly,
plain VPS). The build pipeline is the same everywhere.

## Build pipeline

`npm run build` runs [`script/build.ts`](../script/build.ts), which:

1. **Builds the client** with Vite into `dist/public/`.
   Static assets from `client/public/` are copied into `dist/public/`.
2. **Bundles the server** into a single `dist/index.cjs` with esbuild.
   Imports are resolved, TypeScript is stripped, and the result is a
   self-contained CJS file Node can run with `node dist/index.cjs`.

`npm start` runs:

```bash
NODE_ENV=production node dist/index.cjs
```

In production mode `server/index.ts` skips Vite middleware entirely and
falls through to [`server/static.ts`](../server/static.ts), which
serves `dist/public/` and falls back to `index.html` for client-side
routing.

## Required environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `SESSION_SECRET` | ✅ | `express-session` signing |
| `PORT` | recommended | HTTP port (default 5000) |
| `NODE_ENV` | recommended | must be `production` for the prod build |

## Database setup

```bash
npm run db:push       # apply current schema
```

If pushing into an existing populated DB and Drizzle reports a
destructive change you accept:

```bash
npm run db:push -- --force
```

## Replit Autoscale (the bundled config)

`.replit` declares:

```toml
[deployment]
deploymentTarget = "autoscale"
run = ["node", "./dist/index.cjs"]
build = ["npm", "run", "build"]

[[ports]]
localPort = 5000
externalPort = 80
```

To deploy from the Replit UI: build runs the project, then the run
command serves it. The Replit dev proxy handles TLS, so the app
listens on plain HTTP on `PORT`.

## Health checks

There is no explicit `/healthz` route. Autoscale uses a TCP probe on
`PORT`. If you deploy elsewhere, add a `GET /healthz` returning 200 in
[`server/auth.ts`](../server/auth.ts) — trivial to add.

## WebSocket considerations

The multiplayer endpoint at `/ws` requires the host to support
WebSocket upgrades end-to-end. This is true on Replit Autoscale, all
major PaaS, and any nginx in front of Node configured with the standard
upgrade proxy headers.

## Scaling notes

- The HTTP API is **stateless** (sessions are in Postgres via
  `connect-pg-simple`), so horizontal scaling works.
- The multiplayer roster is **in-memory per process**. If you scale
  past one process, rooms won't be visible across instances. Either
  pin the WS endpoint to a single process or move the roster into Redis.
- The DB load is light — most writes are infrequent autosaves. A small
  managed Postgres is plenty.

## Static assets

Everything in `client/public/` ships as-is. Common gotcha: a
hard-coded path in code that points to a missing file (e.g. a texture
that wasn't checked into `client/public/textures`). Use the existing
files (`asphalt`, `grass`, `sand`, `sky`, `wood`) when you can.

## Verifying a production build locally

```bash
NODE_ENV=production npm run build
NODE_ENV=production PORT=5000 node dist/index.cjs
```

Open http://localhost:5000 and confirm:

- Login works.
- A round trip to `/api/progress/save` succeeds.
- Multiplayer connects (open a second window, create + join a room).
- HMR is **off** (you're hitting bundled JS, not Vite).
