# Repository structure

A map of every directory you'll touch as a contributor.

```
.
├── client/                    Browser app (React + Babylon.js)
│   ├── index.html
│   ├── public/                Static assets served at /
│   │   ├── fonts/
│   │   ├── geometries/        .glb / .gltf models
│   │   ├── models/            Game asset models
│   │   ├── music/             menu.mp3, track_01..03.mp3
│   │   ├── sounds/            background.mp3, hit.mp3, success.mp3
│   │   └── textures/          asphalt.png, grass.png, sand.jpg, sky.png, wood.jpg
│   └── src/
│       ├── App.tsx            Mounts <Game/>
│       ├── main.tsx           React root
│       ├── index.css          Tailwind + globals
│       ├── components/
│       │   └── ui/            shadcn/ui primitives
│       ├── hooks/
│       │   └── use-is-mobile.tsx
│       ├── lib/
│       │   ├── queryClient.ts TanStack Query client (used by some HUD)
│       │   ├── utils.ts       cn() etc.
│       │   └── stores/        useAudio.tsx, useGame.tsx (zustand)
│       └── game/              All gameplay code (≈80 system files)
│
├── server/                    Express API + WS multiplayer
│   ├── index.ts               Boots http server, wires Vite in dev
│   ├── auth.ts                Passport Local + /api/auth/* + /api/progress/*
│   ├── routes.ts              registerRoutes() — adds auth + multiplayer
│   ├── storage.ts             IStorage + DatabaseStorage (Drizzle)
│   ├── db.ts                  pg Pool + Drizzle init
│   ├── multiplayer.ts         WebSocketServer (noServer) on /ws
│   ├── vite.ts                Dev-only Vite middleware + /vite-hmr
│   └── static.ts              Prod static serving
│
├── shared/
│   └── schema.ts              Drizzle tables + Zod insert schemas
│                              (ONLY file imported by both client and server)
│
├── docs/                      You are here
├── Docs/                      Older long-form developer guide
├── attached_assets/           User-uploaded screenshots / refs
│
├── scripts/
│   └── post-merge.sh          Replit post-task reconciliation
├── script/
│   └── build.ts               Production build entry
│
├── README.md                  Player + contributor overview
├── GAMEPLAY_GUIDE.md          Player controls and mechanics
├── replit.md                  Living architectural changelog
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── drizzle.config.ts
└── .replit                    Replit workflow + deploy config
```

## `client/src/game/` — the gameplay codebase

This is where 95% of contributions land. Files are flat (no
sub-directories) and named by responsibility. The two exceptions:

- `lsystem/` — L-system foliage generators
  (`LSystem.ts`, `LSystemRenderer.ts`, `LSystemPresets.ts`,
  `EarthLSystemPresets.ts`, `FoliagePlacement.ts`).
- `Game.tsx` — the React component that wires every system together. Big
  on purpose; the seam between React and Babylon should be in one place.

Naming conventions:

- `XxxSystem.ts` — long-lived class instantiated once from `Game.tsx`.
- `XxxFactory.ts` / `XxxDesigner.ts` — pure functions / classes that
  build meshes or definitions but don't own update loops.
- `Xxx.tsx` — React HUD overlay (renders HTML, not Babylon).
- `XxxPresets.ts` / `XxxParts.ts` — data tables (no logic).

## `server/` — the backend

- The HTTP surface is small (auth, save/load, leaderboard). New
  endpoints go in `server/auth.ts` if they're auth-aware, otherwise in
  `server/routes.ts`.
- All DB access funnels through `server/storage.ts`. Do **not** import
  `db.ts` from elsewhere.
- The WS server uses `noServer: true` and routes upgrades manually so it
  coexists with Vite HMR on the same port. See
  [`how-to/debug-hmr-and-websockets.md`](how-to/debug-hmr-and-websockets.md).

## `shared/schema.ts` — the only shared file

Both client and server import from here. Add new tables, columns, or
shared zod types here and run `npm run db:push`. See
[`how-to/modify-the-database.md`](how-to/modify-the-database.md).

## Generated / ignored

- `node_modules/` — install via `npm install`.
- `dist/` — `npm run build` output.
- `.cache/`, `.local/`, `.config/`, `.upm/` — Replit / tooling.
- `attached_assets/` — user-uploaded reference images. Safe to ignore
  for code work.
