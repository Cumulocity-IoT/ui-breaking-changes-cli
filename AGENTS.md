# Agent Guidelines — c8y-breaking-changes-cli

This file documents conventions, build commands, and constraints for AI agents
working in this repository.

---

## Build & test commands

```bash
pnpm install          # install dependencies (pnpm ≥ 11 required)
pnpm check            # TypeScript type-check (tsc --noEmit) — run after every change
pnpm lint             # Biome lint — run after every change
pnpm test             # unit tests (node:test + tsx loader)
pnpm build            # compile + bundle src/ → dist/ via tsdown
pnpm dev -- <args>    # run from source via tsx (no build step)
```

Always run `pnpm check` **and** `pnpm lint` after editing TypeScript files.

Always run `pnpm check` and `pnpm lint` after editing TypeScript files and fix all errors before
considering a task complete.

---

## Architecture

The CLI is a single-binary TypeScript ESM project (Node.js ≥ 18).

```
src/
  index.ts                        # CLI entry — citty, 3-phase async pipeline
  index.test.ts                   # CLI integration tests (--help, --help-json)
  version-map.ts                  # Pure resolution logic, no I/O
  version-map.test.ts             # Unit tests for resolution logic
  npm-fetcher.ts                  # npm registry fetch + Angular version from peerDependencies
  npm-fetcher.test.ts             # Unit tests for npm-fetcher
  schemas.ts                      # Zod schemas for all external API / HTML responses
  schemas.test.ts                 # Unit tests for schemas
  reporter.ts                     # Output formatting (pretty / json / markdown)
  utils.ts                        # Shared utilities (compareSemver)
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
| CD release | `cd` | Resolved in `src/index.ts` from `npmData.npmInfo.distTags['latest']` after the npm fetch |

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
| `actionRequired` | `string?` | Optional human-readable action hint; may be empty string |
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

## Shared utilities

`src/utils.ts` exports `compareSemver(a, b)` — the single canonical semver comparator
used by `index.ts`, `npm-fetcher.ts`, and `c8y-changelog-fetcher.ts`. Do not add
duplicate comparators; import from here instead.

---

## Security category classification

`classifyWebSdkCategory` in `c8y-changelog-fetcher.ts` uses a **general** security
vocabulary regex (no specific attack-vector names). The pattern matches terms such as
`security`, `vulnerabilit`, `exploit`, `inject`, `attack`, `patch`, `fix`, `threat`,
`breach`, `exposure`, `privilege`, `authori`, `authenticat`, `sanitiz`, `encrypt`,
`malicious`. Do not add specific CVE names or attack types (e.g. `xss`, `csrf`,
`sql injection`) — keep the classifier generic.

---

## Build tooling

### Bundler — tsdown (Rolldown-based)

**`tsdown`** bundles `src/index.ts` into a single self-contained `dist/index.js`.
`chalk`, `citty`, and `zod` are bundled and live in `devDependencies` — the
published npm package has no runtime `dependencies`.

tsdown is configured via `tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown';
export default defineConfig({
  entry: 'src/index.ts',
  outDir: 'dist',
  platform: 'node',
  format: 'esm',
  minify: true,
  clean: true,
  dts: false,
  outputOptions: { entryFileNames: 'index.js' },
});
```

tsdown uses **Rolldown** under the hood. Because `citty` is pure ESM (no CJS
wrapping needed), none of the old Commander-era `createRequire` banner conflicts
apply. The `createRequire` call that reads the package version from
`package.json` at runtime is still present and works correctly with Rolldown — no
shim is required.

**`prepack`** (not `prepare`) triggers the build. `prepare` runs on every
`pnpm install`; `prepack` only runs before `pnpm pack` / `npm publish`.

### Type-checker — tsgo (`@typescript/native-preview`)

**`pnpm check`** runs `tsgo --noEmit` — the Go-rewrite of the TypeScript compiler,
available as `@typescript/native-preview`. It is ~6× faster than `tsc` on this
project (≈0.1 s vs ≈0.5 s) and accepts the same CLI flags. It is still a dev
preview: it supports `--noEmit` and `--watch` but does not yet emit code or run
as a language server. Since the build uses tsdown (not tsc) for emit, `tsgo` is
the right tool for the check-only role. If `tsgo` is broken by a future dev
build, fall back to `tsc --noEmit`.

### Other tools

- **Node.js native type stripping** (`--experimental-strip-types`) is used for dev
  and tests. All relative imports use `.ts` extensions (not `.js`). TypeScript
  accepts this via `allowImportingTsExtensions: true`; `rewriteRelativeImportExtensions:
  true` rewrites them to `.js` on emit via tsdown/Rolldown. `tsx` has been removed.
- **Test glob** — `pnpm test` passes `'src/**/*.test.ts'` as a quoted glob to
  Node's built-in test runner. Node expands it; the shell does not.
- **Biome** (`biome.json`) is the linter/formatter runner. Run `pnpm lint` or
  `./node_modules/.bin/biome lint src/`.
  Formatter is disabled — Biome lint only. All `recommended` rules are enabled.
  Do not add `eslint` or `prettier`.
- **TypeScript 6** requires `"types": ["node"]` in `tsconfig.json`; without it,
  TS6 will not auto-discover `@types/node` and `process`/`console`/`fetch` will
  be unresolved. `verbatimModuleSyntax: true` enforces correct `import type` usage.

---

## Out of scope

- Do not add a database, config file, or caching layer unless explicitly requested.
- Do not add authentication — all data sources are public.
- Do not vendor or snapshot upstream skill data; always fetch live.
