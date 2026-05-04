# HTTP API reference

All routes live in [`server/auth.ts`](../../server/auth.ts) and
[`server/routes.ts`](../../server/routes.ts). Sessions are sent as
HTTP-only cookies; clients must use `credentials: "include"`.

## Authentication

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/auth/register` | none | `{ username, password, displayName? }` | `User` |
| POST | `/api/auth/login` | none | `{ username, password }` | `User` |
| POST | `/api/auth/logout` | session | — | `{ ok: true }` |
| GET  | `/api/auth/me` | session | — | `User` (401 if not logged in) |

Passwords are hashed with **scrypt** (Node `crypto.scrypt`); see
`server/auth.ts` for the salt format. The `users` table stores
`<hashHex>.<saltHex>`.

## Player progress

All require an authenticated session. The save payload is the full
`ProgressSnapshot` defined in
[`client/src/game/ProgressSync.ts`](../../client/src/game/ProgressSync.ts).

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/progress/save` | `{ saveData: ProgressSnapshot }` | `{ ok: true }` |
| GET  | `/api/progress/load` | — | `{ saveData: ProgressSnapshot \| null }` |
| POST | `/api/progress/stats` | `{ level, credits, experience, highestWave, totalKills, hasFlightArmor }` | `{ ok: true }` |

`/api/progress/stats` mirrors headline numbers to the `users` table for
the leaderboard. The full game state stays in `player_progress.saveData`
as a single JSONB column.

## Leaderboard

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/api/leaderboard` | none | `Array<{ username, level, highestWave, totalKills, … }>` (top N) |

The query lives in `DatabaseStorage.getLeaderboard()`
([`server/storage.ts`](../../server/storage.ts)).

## Error format

All errors are JSON: `{ message: string }`. HTTP status codes are
conventional (`400` validation, `401` not authenticated, `404` missing,
`500` server error). The Express error handler in
[`server/index.ts`](../../server/index.ts) is the central catch-all.

## Adding a route

See [`how-to/add-an-api-route.md`](../how-to/add-an-api-route.md).
