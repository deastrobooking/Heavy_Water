# Database schema reference

Source of truth: [`shared/schema.ts`](../../shared/schema.ts).
DB layer: [`server/db.ts`](../../server/db.ts) (Drizzle pg pool) and
[`server/storage.ts`](../../server/storage.ts) (typed access methods).

All migrations apply via `npm run db:push` (Drizzle Kit). There are no
hand-written SQL migration files.

## `users`

The account table.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `username` | `text` UNIQUE NOT NULL | callsign |
| `password` | `text` NOT NULL | scrypt hash + salt, formatted `<hashHex>.<saltHex>` |
| `display_name` | `text` | optional, distinct from username |
| `level` | `integer` | mirrored from save data via `/api/progress/stats` |
| `credits` | `integer` | mirrored |
| `experience` | `integer` | mirrored |
| `highest_wave` | `integer` | mirrored |
| `total_kills` | `integer` | mirrored |
| `has_flight_armor` | `boolean` | mirrored |
| `last_login` | `timestamp` | |
| `created_at` | `timestamp` defaultNow | |

Mirrored columns are duplicated from `player_progress.saveData` so the
leaderboard query is cheap.

## `player_progress`

The full game-state save.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `user_id` | `integer` NOT NULL | FK by convention to `users.id` |
| `save_data` | `jsonb` | Serialized `ProgressSnapshot` (see `client/src/game/ProgressSync.ts`) |
| `updated_at` | `timestamp` defaultNow | |

> Adding a per-player game-state field does **not** require a schema
> change — just extend `ProgressSnapshot` in `ProgressSync.ts`. See
> [`how-to/modify-the-database.md`](../how-to/modify-the-database.md).

## `game_sessions`

Multiplayer room registry.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `room_code` | `varchar(8)` UNIQUE NOT NULL | client-facing join code |
| `host_user_id` | `integer` NOT NULL | who created the room |
| `max_players` | `integer` default 4 | up to 16 |
| `current_players` | `integer` default 1 | tracked by server |
| `status` | `varchar(20)` default `"waiting"` | `waiting` / `playing` / `closed` |
| `created_at` | `timestamp` defaultNow | |

Note: the in-flight roster is in-memory in `server/multiplayer.ts`;
this table is mostly for the lobby UI's room list.

## `user_sessions`

`express-session` + `connect-pg-simple` session store.

| Column | Type |
|---|---|
| `sid` | `text` PK |
| `sess` | `jsonb` |
| `expire` | `timestamp` |

Don't read from this directly — `express-session` owns it.

## Zod insert schemas

`shared/schema.ts` exports `insertUserSchema` (and similar) via
`drizzle-zod`'s `createInsertSchema`. Use these for validation in HTTP
handlers; do not hand-roll new validators for inserts.

## Inferred types

```ts
export type User           = typeof users.$inferSelect;
export type PlayerProgress = typeof playerProgress.$inferSelect;
export type GameSession    = typeof gameSessions.$inferSelect;
export type InsertUser     = z.infer<typeof insertUserSchema>;
```

These are the canonical names — import from `shared/schema` everywhere.

## Modifying the schema

See [`how-to/modify-the-database.md`](../how-to/modify-the-database.md).
