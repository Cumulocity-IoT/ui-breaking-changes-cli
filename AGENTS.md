# Agent Guidelines — c8y-breaking-changes-cli

This file documents conventions, build commands, and constraints for AI agents
working in this repository.

---

## Build & test commands

```bash
pnpm install          # install dependencies (pnpm ≥ 9 required)
pnpm check            # TypeScript type-check (tsc --noEmit) — run after every change
pnpm test             # unit tests (node:test, no extra deps)
pnpm build            # compile src/ → dist/
pnpm dev -- <args>    # run from source via tsx (no build step)
```

Always run `pnpm check` after editing TypeScript files and fix all errors before
considering a task complete.

---

## Architecture

The CLI is a single-binary TypeScript ESM project (Node.js ≥ 18).

```
src/
  index.ts                        # CLI entry — Commander, 3-phase async pipeline
  index.test.ts                   # CLI integration tests (--help, --help-json)
  version-map.ts                  # Pure resolution logic, no I/O
  version-map.test.ts             # Unit tests for resolution logic
  npm-fetcher.ts                  # npm registry fetch + Angular version from peerDependencies
  schemas.ts                      # Zod schemas for all external API / HTML responses
  schemas.test.ts                 # Unit tests for schemas
  reporter.ts                     # Output formatting (pretty / json / markdown)
  data/
    breaking-changes.ts           # Type definitions only — no hardcoded data
  fetchers/
    github-skills-fetcher.ts      # All dynamic data fetching from GitHub skills repo
    angular-changelog-fetcher.ts  # Breaking changes from Angular GitHub releases API
    angular-changelog-fetcher.test.ts
    c8y-changelog-fetcher.ts      # Live Cumulocity changelog page scraper (unused in main pipeline)
    c8y-changelog-fetcher.test.ts
```

**No hardcoded breaking-change data.** Everything is fetched at runtime from:
- `https://raw.githubusercontent.com/Cumulocity-IoT/cumulocity-skills/main/skills/` (WebSDK changelog, REST API changelog, version map, upgrade skill guides)
- `https://registry.npmjs.org/@c8y/ngx-components` (latest patch versions, CD release, Angular major version via peerDependencies)
- `https://api.github.com/repos/angular/angular/releases/tags/{N}.0.0` (Angular release notes — fetched when the traversal crosses Angular major versions)
- `https://cumulocity.com/docs/{year}/change-logs/` (live Cumulocity changelog — scraped by `c8y-changelog-fetcher.ts`, not yet wired into the main pipeline)

---

## Key conventions

### Module system
- `"type": "module"` — all imports must use `.js` extensions (even for `.ts` sources).
- `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` in tsconfig.

### No hardcoding
Never add static version data, breaking-change lists, or stable-line strings.
All such data must be fetched and parsed from the upstream sources above.

### Error handling
- Network failures must be graceful (fallback to `null` / empty results, never crash).
- Only `process.exit(1)` at the top-level CLI layer — never inside library modules.

### Test files
- Test files are named `*.test.ts` and co-located in `src/`.
- They are excluded from the production build via `tsconfig.json`.
- Use only `node:test` and `node:assert/strict` — no external test framework.

---

## Version resolution

`resolveVersion(alias, versions)` in `src/version-map.ts` accepts:

| Input | Example | Resolved by |
|---|---|---|
| LTS alias | `2026-lts` | Exact `ltsAlias` match |
| Year alias | `2026`, `y2026` | `yearAlias` match after stripping `y` prefix |
| Stable line | `1023.14`, `1021` | `stableLine.startsWith(normalized)` |
| Full patch | `1023.13.2` | Major segment fallback (`"1023"` → `stableLine` prefix) |
| CD release | `cd` | Resolved in `src/index.ts` via `fetchLatestCdVersion()` before calling `resolveVersion` |

`getVersionRange(from, to, versions)` returns an empty array (`[]`) when:
- `from` and `to` are the same version
- `from` is newer than `to` (the caller treats this as an error)

---

## GitHub Actions workflow

`.github/workflows/check-breaking-changes.yml` is designed to be **copied** into
consumer repositories. It reads `@c8y/ngx-components` from the consumer's
`package.json` as the `--from` version and uses
`Cumulocity-IoT/plugins-e2e-setup/collect-shell-versions@main` to determine
the `--to` version.

---

## Out of scope

- Do not add a database, config file, or caching layer unless explicitly requested.
- Do not add authentication — all data sources are public.
- Do not vendor or snapshot upstream skill data; always fetch live.
