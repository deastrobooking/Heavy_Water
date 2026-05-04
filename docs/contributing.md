# Contributing

Heavy Water is open source under the MIT license. PRs are welcome.

## Before you start

- Read [`architecture.md`](architecture.md) to get the lay of the land.
- Skim the matching how-to in [`how-to/`](how-to/) for the change you
  plan to make. Almost every kind of change is documented.
- For non-trivial features, open an issue describing the design first.

## Development loop

```bash
npm install
npm run db:push
npm run dev          # http://localhost:5000
npm run check        # tsc, run before committing
```

There is no test suite. The de-facto CI check is `npm run check` plus
manual smoke testing.

## Code style

- **TypeScript everywhere.** No plain JS in new code.
- **One concern per file.** New gameplay systems are `XxxSystem.ts`.
- **Comments explain why, not what.** Match the existing voice — terse,
  load-bearing, often pointing forward to the next consumer of the
  data ("the spawner reads this flag to decide …").
- **No magic numbers in tables.** Pull constants out and name them.
- **Cell-shading consistency.** Reuse existing materials; don't roll a
  new shader for a one-off effect without good reason.
- **Mesh height/2 rule.** All mesh positions must be set so the mesh
  rests on the ground rather than sinking. Project-wide.
- **EventBus over imports.** When two systems need to communicate, add
  an event rather than importing one from the other.
- **Always `bus.off` in dispose.** Forgetting this leaks listeners
  across level transitions and is the #1 source of ghost behavior.
- **Storage layer.** All DB access goes through `server/storage.ts`.
  Don't import `db.ts` from anywhere else.

## Commit hygiene

- One logical change per commit.
- Imperative mood subject line ("Add X", not "Added X").
- If your change touches an architectural area, **update [`replit.md`](../replit.md)
  in the same commit.** That file is the agent-maintained changelog and
  is the authoritative "what major systems exist" document.
- If you add or change an event, route, or schema column, update the
  matching reference in [`docs/reference/`](reference/).

## PR checklist

- [ ] `npm run check` is green.
- [ ] Manually smoke-tested the changed feature.
- [ ] Added/updated the relevant `docs/` page.
- [ ] Updated `replit.md` if you changed architecture.
- [ ] No `console.log` left behind from debugging.
- [ ] No untracked secrets / API keys.

## License

MIT — see `package.json`. By contributing, you agree your contribution
is under the same license.

## Where to ask questions

Open an issue on the repo. Tag with `question` if it's not a bug
report. For architectural debates, link the relevant
[`docs/architecture.md`](architecture.md) or
[`replit.md`](../replit.md) section in the issue.
