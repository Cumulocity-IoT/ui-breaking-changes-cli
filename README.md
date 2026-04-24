# c8y-breaking-changes-cli

CLI to detect and list breaking changes between [Cumulocity Web SDK](https://cumulocity.com/docs/) versions.

All breaking change data is fetched at runtime from the [Cumulocity skills repository](https://github.com/Cumulocity-IoT/cumulocity-skills) — nothing is hardcoded.

---

## Requirements

- Node.js ≥ 18
- pnpm ≥ 9

---

## Installation

```bash
# From source
pnpm install
pnpm build
npm install -g .

# Or run directly without installing
pnpm dev --from 2025-lts --to 2026-lts
```

---

## Usage

### Check breaking changes

```bash
c8y-breaking-changes --from <version> --to <version> [options]
```

| Option | Description |
|---|---|
| `-f, --from <version>` | Your current SDK version (upgrading FROM) **(required)** |
| `-t, --to <version>` | The SDK version you are upgrading TO **(required)** |
| `--format <format>` | Output format: `pretty` (default), `json`, `markdown` |
| `--breaking-only` | Show only `BREAKING` severity items; suppress NOTABLE and INFO |
| `--category <cat>` | Filter to one category: `angular`, `websdk-ui`, `rest-api`, `security`, `migration` |
| `--show-grep` | Print grep search patterns to locate affected symbols in your codebase |
| `--no-npm` | Skip the npm registry lookup; omits latest patch version info |
| `--no-color` | Disable ANSI colour codes (useful when piping output) |
| `--help-json` | Output the full CLI schema as JSON for programmatic or LLM use, then exit |

### List known versions

```bash
c8y-breaking-changes versions
```

---

## Version aliases

| Format | Examples |
|---|---|
| LTS alias | `2023-lts`, `2024-lts`, `2025-lts`, `2026-lts` |
| Year alias | `2025`, `2026`, `y2025` |
| Minor / stable line | `1021`, `1023`, `1021.22` |
| Full patch version | `1021.22.145`, `1023.13.2` |
| CD release | `cd` — resolves to the current `latest` tag on npm |

---

## Examples

```bash
# Pretty output (default)
c8y-breaking-changes --from 2024-lts --to 2026-lts

# JSON (suitable for CI scripts)
c8y-breaking-changes --from 2025-lts --to 2026-lts --format json

# Markdown (suitable for GitHub Step Summary or PR comments)
c8y-breaking-changes --from 2025-lts --to 2026-lts --format markdown

# Use the pinned version from your package.json as --from, latest CD as --to
c8y-breaking-changes --from 1021.22.50 --to cd

# Compare an older CD build (from a previous LTS line, ~3 weeks ago) to today's CD release.
# Both versions are resolved to their LTS line: 1021.55.3 → 2025-lts, cd → 2026-lts.
c8y-breaking-changes --from 1021.55.3 --to cd

# If --from and --to are CD builds on the *same* LTS line (e.g. both 1023.x),
# they resolve to the same LTS alias and the CLI reports "same version" —
# there are no cross-line breaking changes between them.
# c8y-breaking-changes --from 1023.68.0 --to cd  →  Error: same version

# Only show blocking issues, filtered to Angular changes
c8y-breaking-changes --from 2024-lts --to 2026-lts --breaking-only --category angular

# Skip npm lookup for faster offline-like runs
c8y-breaking-changes --from 2025-lts --to 2026-lts --no-npm

# Show grep hints so you can locate affected symbols in your codebase
c8y-breaking-changes --from 2025-lts --to 2026-lts --show-grep
```

### --help-json

Outputs the complete CLI schema as a single JSON object. Intended for programmatic
consumption by LLMs, agents, and CI tooling that need to understand the interface
without parsing human-readable text.

```bash
c8y-breaking-changes --help-json | jq '.commands[0].options[].flags'
```

---

## GitHub Actions

A ready-made workflow is included at [`.github/workflows/check-breaking-changes.yml`](.github/workflows/check-breaking-changes.yml).

Copy it to your WebSDK plugin or application repository. It:

1. Reads the pinned `@c8y/ngx-components` version from your `package.json` (`--from`)
2. Fetches the latest cockpit release via [`collect-shell-versions`](https://github.com/Cumulocity-IoT/plugins-e2e-setup) (`--to`)
3. Runs the CLI and counts `BREAKING` changes
4. Writes a markdown summary to the GitHub Step Summary
5. Posts (and updates) a PR comment with the full report
6. Fails the job when breaking changes are found (configurable)

### Triggers

| Trigger | When |
|---|---|
| `pull_request` | On changes to `package.json` or lock files |
| `push` | On pushes to `main` / `develop` |
| `schedule` | Daily at 06:00 UTC |
| `workflow_dispatch` | Manual run, with optional version overrides |

---

## Development

```bash
pnpm install       # install dependencies
pnpm dev           # run via tsx (no build step needed)
pnpm check         # TypeScript type-check
pnpm test          # run unit tests
pnpm build         # compile to dist/
```

### Project structure

```
src/
  index.ts                              # CLI entry point (Commander)
  index.test.ts                         # CLI integration tests (node:test)
  version-map.ts                        # SdkVersion type + resolveVersion / getVersionRange
  version-map.test.ts                   # Unit tests (node:test)
  npm-fetcher.ts                        # npm registry fetch (latest patch versions, CD release, Angular version)
  schemas.ts                            # Zod schemas for all external API / HTML responses
  schemas.test.ts                       # Unit tests for schemas
  reporter.ts                           # Output formatting (pretty / json / markdown)
  data/
    breaking-changes.ts                 # Type definitions only (no hardcoded data)
  fetchers/
    github-skills-fetcher.ts            # Fetches + parses all data from cumulocity-skills
    angular-changelog-fetcher.ts        # Breaking changes from Angular GitHub releases API
    angular-changelog-fetcher.test.ts
    c8y-changelog-fetcher.ts            # Live Cumulocity changelog scraper (not yet in main pipeline)
    c8y-changelog-fetcher.test.ts
.github/
  workflows/
    check-breaking-changes.yml          # GitHub Actions workflow
```

### Data sources

| Source | What it provides |
|---|---|
| `Cumulocity-IoT/cumulocity-skills` | Version map, breaking change changelog, migration guides |
| `registry.npmjs.org/@c8y/ngx-components` | Latest patch versions per LTS line, CD (`latest`) release, Angular major version via peerDependencies |
| `api.github.com/repos/angular/angular` | Angular release notes — fetched per major version crossed during an upgrade |
| `cumulocity.com/docs/{year}/change-logs/` | Live Cumulocity changelog (scraped by `c8y-changelog-fetcher`) |

---

## How breaking changes are derived

The CLI fetches from three distinct sources on every run and merges the results into a single report.

### 1. WebSDK / Angular breaking changes

**Source skill:** [`websdk-breaking-changelog`](https://github.com/Cumulocity-IoT/cumulocity-skills/blob/main/skills/websdk-breaking-changelog/SKILL.md)  
**Underlying data:** `https://cumulocity.com/docs/{year}/change-logs/?component=.component-web-sdk`

Each LTS line documents its changes with `BREAKING`, `NOTABLE`, or `INFO` severity markers. The CLI reads every section within the traversal range (from-exclusive, to-inclusive) and classifies each entry by category:

| Category | Detection rule |
|---|---|
| `angular` | Title contains "Angular N Upgrade" |
| `security` | Title/body mentions "security", "XSS", "CSS injection", or "vulnerability" |
| `websdk-ui` | Everything else from this skill |

**Angular release notes (live):** [`angular-changelog-fetcher`](src/fetchers/angular-changelog-fetcher.ts)  
**Source:** `https://api.github.com/repos/angular/angular/releases/tags/{N}.0.0`

Whenever the traversal crosses an Angular major version boundary, the CLI fetches the official Angular GitHub release notes directly — for **every** Angular major between the from and to versions (inclusive). For a 2025-lts (Angular 18) → 2026-lts (Angular 20) upgrade this means Angular 19 *and* Angular 20 are fetched, because `ng update @angular/core@20` applies both sets of migration schematics.

Angular releases use a consistent `## Breaking Changes\n### package\n- bullet` format. The parser extracts each bullet per package and adds it as a `BREAKING / angular` entry attributed to the LTS alias that introduced the corresponding Angular major.

**Relationship to the skills data:** The `websdk-breaking-changelog` skill contains a single curated "Angular N Upgrade" entry summarising the Cumulocity-specific impact. The Angular release notes provide the **full upstream** Angular breaking changes on top of that.

**Example — 2025-lts → 2026-lts returns (8 BREAKING, 4 NOTABLE):**

| Severity | Category | Title |
|---|---|---|
| BREAKING | angular | Angular 20 Upgrade; `standalone` flag default changed |
| BREAKING | websdk-ui | Separate login application replaces built-in login |
| BREAKING | websdk-ui | `OperationsListModule` removed |
| BREAKING | websdk-ui | `getNamedDashboardOrCreate` removed from context-dashboard service |
| BREAKING | websdk-ui | Routes that use context dashboards must define `rootContext: ViewContext.Dashboard` |
| BREAKING | websdk-ui | `loadConfigComponent` deprecated; widget config sections changed |
| BREAKING | websdk-ui | Wildcard search replaces full-text search |
| BREAKING | websdk-ui | LWM2M module will be removed from `@c8y/ngx-components` |
| NOTABLE | security | HTML widget moved to GA; strict sanitization enabled by default |
| NOTABLE | security | Security: XSS vulnerability fixed in custom tooltips (Echarts) |
| NOTABLE | security | Security: CSS injection vulnerability fixed |
| NOTABLE | websdk-ui | New data explorer and Data point graph widget — now GA |

---

### 2. REST API breaking changes

**Source skill:** [`c8y-client-breaking-changelog`](https://github.com/Cumulocity-IoT/cumulocity-skills/blob/main/skills/c8y-client-breaking-changelog/SKILL.md)  
**Underlying data:** `https://cumulocity.com/docs/change-logs/?component=.component-rest-api`

Only entries tagged **API CHANGE** are included. Each entry carries a `Date:` field which the CLI maps to an LTS alias dynamically: the entry is attributed to the most recent LTS year that is ≤ the entry's publication year. This means REST API changes land in the report when their date falls within the traversal range.

**Example — 2024-lts → 2026-lts includes these REST-API changes (all dated 2025, attributed to 2025-lts):**

| Entry | Date | Impact |
|---|---|---|
| `history` field removed from the Alarm API | Dec 2025 | `IAlarm.history` no longer present in responses |
| Enhanced security for encrypted tenant options | Oct 2025 | `TenantOptionsService` may return `<<Encrypted>>` for non-owning callers |
| Inventory API — `withChildren` default changed `true` → `false` | Sep 2025 | Must pass `{ withChildren: true }` explicitly |
| Inventory `withParents=true` now returns all ancestors | Sep 2025 | Previously capped at 3 levels |
| Measurement API — time series sort order changed to newest-first | Sep 2025 | Add `revert: false` to restore ascending order |
| `c8y_PreviousMeasurements` is now a restricted property | Jul 2025 | Fragment silently ignored on create/update |
| Inventory wildcard search is now case-insensitive | Jun 2025 | Wildcard queries may return broader results |
| Notifications 2.0 — wildcard subscriptions now include operations | Jan 2025 | Subscribers must handle operation payloads |

> REST API changes are absent from a 2025-lts → 2026-lts run because the skills repository has not yet catalogued 2026-dated API changes. As the skills content is updated, they will appear automatically.

---

### 3. Version-specific migration guides

**Source skills:** `websdk-{major}-upgrade` (e.g. [`websdk-1023-upgrade`](https://github.com/Cumulocity-IoT/cumulocity-skills/blob/main/skills/websdk-1023-upgrade/SKILL.md))  
**Mirrors content from:** [`cumulocity.com/codex/migration-guides/updating-web-sdk-version/`](https://cumulocity.com/codex/migration-guides/updating-web-sdk-version/overview#version-specific-migration)

For each LTS version in the traversal range, the CLI fetches the corresponding upgrade skill and extracts the numbered migration steps. The guide covers:

- `ng update` commands to run for the Angular upgrade
- Exact `@c8y/*` dependency versions to pin in `package.json`
- Peer dependency requirements (TypeScript, Node.js, RxJS, `ngx-bootstrap`, `@angular/cdk`)
- Breaking API changes with before/after code examples
- `grep` patterns to locate affected symbols in your codebase

The CLI applies upgrade skills **one step at a time** in version order. A multi-hop upgrade (e.g. 2024-lts → 2026-lts) fetches and concatenates the guides for each intermediate version.

**Example — migration steps for the 2025-lts → 2026-lts hop (websdk-1023-upgrade, 8 steps):**

| Step | Action |
|---|---|
| 1 | `ng update @angular/core@20 @angular/cli@20` |
| 2 | Update all `@c8y/*` packages to `1023.x.x` |
| 3 | Update TypeScript to `>=5.9.3` |
| 4 | Update `ngx-bootstrap` to `20.0.2` |
| 5 | Update `@angular/cdk` (and `@angular/material`) to `@20` |
| 6 | Verify Node.js (`^20.11 \|\| ^22`), TypeScript, and RxJS compatibility |
| 7 | `rm -rf node_modules && npm install` |
| 8 | `npm start` — fix remaining compilation errors |
