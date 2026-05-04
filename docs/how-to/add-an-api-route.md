# How to add a new HTTP API route

The HTTP surface is intentionally small. Almost every new endpoint is
either an auth-aware `/api/*` route or an admin/debug route. This guide
covers both.

## 1. Decide where it lives

| Route kind | File |
|---|---|
| Anything under `/api/auth/*` or `/api/progress/*` | [`server/auth.ts`](../../server/auth.ts) |
| New top-level resource (e.g. `/api/clans/...`) | [`server/routes.ts`](../../server/routes.ts) |
| Static asset (rare) | [`server/static.ts`](../../server/static.ts) |

`server/auth.ts` is where Passport is configured **and** where most
session-aware routes live, because they need access to `req.user`.

## 2. Add the handler

Example — a leaderboard-by-level endpoint:

```ts
// server/auth.ts
app.get("/api/leaderboard/:level", async (req, res, next) => {
  try {
    const level = parseInt(req.params.level, 10);
    if (Number.isNaN(level)) return res.status(400).json({ message: "bad level" });

    const rows = await storage.getLeaderboardByLevel(level);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
```

Rules of the road:

- **All DB access goes through `storage`** — see
  [`server/storage.ts`](../../server/storage.ts). Add a method to
  `IStorage` and implement it in `DatabaseStorage`. Do **not** import
  `db.ts` from your handler.
- **Validate inputs.** Use Zod schemas — they're already in the project
  (`drizzle-zod` for table inserts, raw `zod` elsewhere). Return `400`
  on validation failure.
- **Catch + `next(err)`.** The Express error handler in
  [`server/index.ts`](../../server/index.ts) turns thrown errors into
  JSON responses. Don't swallow them.
- **Auth gating.** For session-required routes, check `req.isAuthenticated()`
  early and return `401` if false. See `/api/progress/save` for the
  shape.

## 3. Add a `storage` method

File: [`server/storage.ts`](../../server/storage.ts)

```ts
export interface IStorage {
  // …existing…
  getLeaderboardByLevel(level: number): Promise<LeaderboardRow[]>;
}

export class DatabaseStorage implements IStorage {
  // …existing…
  async getLeaderboardByLevel(level: number) {
    return db
      .select({ /* … */ })
      .from(users)
      .where(/* … */)
      .orderBy(/* … */)
      .limit(50);
  }
}
```

## 4. Call it from the client

Most fetches happen through plain `fetch()` with `credentials: "include"`
so the session cookie is sent. Example pattern from `ProgressSync.ts`:

```ts
await fetch("/api/leaderboard/3", { credentials: "include" });
```

For React components that need TanStack Query, use the configured client
in [`client/src/lib/queryClient.ts`](../../client/src/lib/queryClient.ts).

## 5. Document it

Add a row to [`reference/http-api.md`](../reference/http-api.md) with
the path, method, auth requirement, and example payload.

## 6. Verify

```bash
npm run check
npm run dev
curl -i http://localhost:5000/api/leaderboard/3
```

Confirm:

- Unauthenticated calls return `401` if you required auth.
- Bad inputs return `400`.
- Successful calls return JSON.
- The endpoint shows up in the network tab from the in-game HUD when
  triggered.
