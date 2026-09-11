# Contributing to M8m

Welcome! M8m is open source and we appreciate contributions.

## Good first contributions

- **New analyzer rules** — see `src/core/analyzer.ts`. Each rule is a
  self-contained function with clear patterns. Add positive and negative test
  cases in `tests/core/analyzer.test.ts`.
- **File watcher parsers** — support new memory file formats in
  `src/watcher/parsers.ts`. Add test fixtures in `tests/fixtures/`.
- **Documentation** — improve the README, add examples, write tutorials.
- **Bug fixes** — check GitHub issues tagged `bug`.

## What needs discussion first

Please open an issue to discuss before submitting a PR for:

- Database schema changes (affects all components)
- New MCP tools (changes the agent interface contract)
- Architectural changes
- New dependencies

## Development setup

```bash
git clone https://github.com/th0t3p/m8m.git
cd m8m
npm install
npm run build
npm test
```

## Code standards

- TypeScript strict mode.
- Minimize `any` — it is tolerated only in database row mappers and MCP tool
  argument boundaries.
- Every analyzer rule needs at least 3 positive and 3 negative test cases.
- All database writes must create changelog entries.
- Security-relevant operations must create security events.
- Run `npm test` and `npm run build` before opening a PR.
