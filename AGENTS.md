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
    angular-changelog-fetcher.ts  # Breaking changes from Angular GitHub releases API
    angular-changelog-fetcher.test.ts
    c8y-changelog-fetcher.ts      # Live Cumulocity changelog scraper — WebSDK + REST API changes + orchestration
    c8y-changelog-fetcher.test.ts
```

**No hardcoded breaking-change data.** Everything is fetched at runtime from:
- `https://registry.npmjs.org/@c8y/ngx-components` (latest patch versions, CD release, Angular major version via peerDependencies)
- `https://cumulocity.com/docs/change-logs/` (both WebSDK **and** REST API changes — single global page for both)
- `https://api.github.com/repos/angular/angular/releases/tags/{N}.0.0` (Angular release notes — fetched when the traversal crosses Angular major versions)

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
| LTS alias | `2026-lts`, `y2026-lts` | Exact `ltsAlias` match (y-prefix stripped) |
| Year alias | `2026`, `y2026` | `yearAlias` match after stripping `y` prefix |
| Stable line | `1023.14`, `1021` | `stableLine.startsWith(normalized)` |
| Full patch | `1023.13.2` | Major segment fallback (`"1023"` → `stableLine` prefix) |
| CD release | `cd` | Resolved in `src/index.ts` via `fetchLatestCdVersion()` before calling `resolveVersion` |

`getVersionRange(from, to, versions)` returns an empty array (`[]`) when:
- `from` and `to` are the same version
- `from` is newer than `to` (the caller treats this as an error)

---

## GitHub Actions workflow

`sample/check-breaking-changes.yml` is designed to be **copied** into
consumer repositories. It reads `@c8y/ngx-components` from the consumer's
`package.json` as the `--from` version and uses
`Cumulocity-IoT/plugins-e2e-setup/collect-shell-versions@main` to determine
the `--to` version.

---

## BreakingChange fields

| Field | Type | Notes |
|---|---|---|
| `introducedIn` | `string?` | LTS alias; **absent** for REST API entries (stripped before output); used internally for sorting only |
| `severity` | `'BREAKING' \| 'NOTABLE' \| 'INFO'` | — |
| `category` | `Category` | — |
| `title` | `string` | — |
| `description` | `string` | — |
| `uiVersion` | `string?` | Semver parsed from `data-tag="technicalcomponent-ui-c8y"` button in the HTML; present on WebSDK entries; used as additional range filter and shown in reporter output |
| `sourceUrl` | `string?` | — |
| `grepHints` | `string[]?` | — |

---

## uiVersion range filter

When a WebSDK entry carries a `uiVersion`, `convertEntry` applies an extra filter on top of the date check:

- **Major-only** (e.g. `1023.0.0`, where minor and patch are both 0): the entry is included when `uiMajor` falls within `[fromMajor, toMajor]` — meaning "this change applies to any 1023.x upgrade".
- **Exact version** (e.g. `1022.8.3`): included only when `uiVersion` is strictly after `fromVersion` and at most `toVersion` (mirrors the date-filter semantics).

REST API entries never have a `uiVersion`.

---

## Out of scope

- Do not add a database, config file, or caching layer unless explicitly requested.
- Do not add authentication — all data sources are public.
- Do not vendor or snapshot upstream skill data; always fetch live.
