# How to modify the database

The project uses **Drizzle ORM** with `drizzle-kit push` — there are no
hand-written migrations. The schema is the single source of truth.

## 1. Edit the schema

File: [`shared/schema.ts`](../../shared/schema.ts)

This is the only file imported by both client and server. Add columns,
tables, or Zod insert schemas here.

```ts
export const clans = pgTable("clans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  hostUserId: integer("host_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClanSchema = createInsertSchema(clans).pick({
  name: true,
  hostUserId: true,
});
export type InsertClan = z.infer<typeof insertClanSchema>;
export type Clan = typeof clans.$inferSelect;
```

## 2. Push to the database

```bash
npm run db:push
```

If the change is destructive (drops a column, narrows a type) Drizzle
will refuse and tell you so. To apply anyway:

```bash
npm run db:push -- --force
```

> Force-pushing on a populated database **drops data**. Back up first
> if it matters.

## 3. Update `storage.ts`

File: [`server/storage.ts`](../../server/storage.ts)

Add interface methods + implementations for any new reads/writes. All
DB access funnels through this file — see
[`how-to/add-an-api-route.md`](add-an-api-route.md).

## 4. Update routes / consumers

Wire your new methods into HTTP handlers (`server/auth.ts` or
`server/routes.ts`).

## 5. Player progress is special

Player save data lives in the `player_progress` table as a single
`jsonb` column (`saveData`). The shape of that JSON is the
**`ProgressSnapshot`** TypeScript type defined in
[`client/src/game/ProgressSync.ts`](../../client/src/game/ProgressSync.ts).

That means: **adding a per-player game-state field does not require a
schema change.** Just:

1. Add the field to `ProgressSnapshot`.
2. Snapshot it in `buildSnapshot`.
3. Restore it in the load handler.
4. Default-tolerate older snapshots that lack the field
   (`snapshot.myField ?? defaultValue`).

You only touch `shared/schema.ts` when adding **structural** data
(new tables, indexed columns, leaderboard fields, etc.).

## 6. Document it

Add a row to [`reference/database-schema.md`](../reference/database-schema.md).

## Verification

- `npm run db:push` succeeds without errors.
- `\dt` in `psql` shows your new table; `\d table_name` shows your
  new columns.
- A round-trip test from the client (or `curl`) confirms the data
  reads and writes correctly.
