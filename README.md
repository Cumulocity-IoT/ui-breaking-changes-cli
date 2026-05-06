# c8y-breaking-changes-cli

The unofficial CLI to detect and list breaking changes between [Cumulocity Web SDK](https://cumulocity.com/docs/) versions.

All breaking change data is fetched at runtime by scraping the live Cumulocity documentation pages and the npm registry — nothing is hardcoded.

---

## Requirements

- Node.js ≥ 18
- pnpm ≥ 9

---

## Installation

### From a release artifact

Download the `.tgz` from the [GitHub Releases](../../releases) page, then:

```bash
# run directly without installing
tar -xzf c8y-breaking-changes-cli-v*.*.*.tgz
node index.js --from 2025-lts --to 2026-lts
```

### From source

```bash
pnpm install
pnpm build
pnpm install -g .
node index.js --from 2025-lts --to 2026-lts

# Or run without installing
pnpm dev --from 2025-lts --to 2026-lts
```

> **Note:** The published tarball contains only `dist/index.js` (a self-contained bundle), `README.md`, and `LICENSE`.
> `src/`, test files, and lock files are excluded.

---

## Usage

### Check breaking changes

```bash
node index.js --from <version> --to <version> [options]
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
node index.js versions
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
node index.js --from 2024-lts --to 2026-lts

# JSON (suitable for CI scripts)
node index.js --from 2025-lts --to 2026-lts --format json

# Markdown (suitable for GitHub Step Summary or PR comments)
node index.js --from 2025-lts --to 2026-lts --format markdown

# Use the pinned version from your package.json as --from, latest CD as --to
node index.js --from 1021.22.50 --to cd

# Compare an older CD build (from a previous LTS line, ~3 weeks ago) to today's CD release.
# Both versions are resolved to their LTS line: 1021.55.3 → 2025-lts, cd → 2026-lts.
node index.js --from 1021.55.3 --to cd

# If --from and --to are CD builds on the *same* LTS line (e.g. both 1023.x),
# they resolve to the same LTS alias and the CLI reports "same version" —
# there are no cross-line breaking changes between them.
# node index.js --from 1023.68.0 --to cd  →  Error: same version

# Only show blocking issues, filtered to Angular changes
node index.js --from 2024-lts --to 2026-lts --breaking-only --category angular

# Skip npm lookup for faster offline-like runs
node index.js --from 2025-lts --to 2026-lts --no-npm

# Show grep hints so you can locate affected symbols in your codebase
node index.js --from 2025-lts --to 2026-lts --show-grep
```

### --help-json

Outputs the complete CLI schema as a single JSON object. Intended for programmatic
consumption by LLMs, agents, and CI tooling that need to understand the interface
without parsing human-readable text.

```bash
node index.js --help-json | jq '.commands[0].options[].flags'
```

---

## GitHub Actions

A ready-made workflow is included at [`sample/check-breaking-changes.yml`](sample/check-breaking-changes.yml).

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
    angular-changelog-fetcher.ts        # Breaking changes from Angular GitHub releases API
    angular-changelog-fetcher.test.ts
    c8y-changelog-fetcher.ts            # Live Cumulocity changelog scraper (cumulocity.com/docs)
    c8y-changelog-fetcher.test.ts
sample/
  check-breaking-changes.yml            # Ready-made GitHub Actions workflow to copy into consumer repos
```

### Data sources

| Source | What it provides |
|---|---|
| `registry.npmjs.org/@c8y/ngx-components` | Version map (from `y????-lts` dist-tags), latest patch versions, Angular version via `peerDependencies`, per-version publish timestamps (`time` field) |
| `cumulocity.com/docs/change-logs/` | Both WebSDK (`component-web-sdk`) and REST API (`component-rest-api`) changes — a single request to the global aggregated page covers both |
| `api.github.com/repos/angular/angular` | Angular release notes — fetched per major version crossed during an upgrade |

---

## How breaking changes are derived

The CLI fetches from three distinct sources on every run and merges the results into a single report.

### 1. Version map

**Source:** `https://registry.npmjs.org/@c8y/ngx-components` (dist-tags)

The SDK version list is derived entirely from npm dist-tags. Tags matching `y????-lts` (e.g. `y2025-lts`, `y2026-lts`) are resolved to their current full semver, from which the stable line and Angular version (via `peerDependencies`) are derived dynamically. There is no hardcoded version map.

Future LTS lines (e.g. `y2027-lts`) appear automatically as soon as the tag exists. For an established LTS like 2026-lts, only the patch segment changes (`1023.14.x`) — the major and minor are fixed once the line stabilises.

---

### 2. WebSDK / Angular breaking changes

**Source:** `https://cumulocity.com/docs/change-logs/` (single global request for both WebSDK and REST API)
**Equivalent filters:** `?component=.component-web-sdk&change-type=.change-type-announcement`, `?component=.component-web-sdk&change-type=.change-type-api-change`

A single request to the global aggregated changelog page is made — the same URL used for REST API changes. The CLI filters `<section>` blocks by CSS class: `component-web-sdk` combined with `change-type-announcement` or `change-type-api-change`. Date-based filtering (entry date vs. npm release dates of `fromVersion`/`toVersion`) is applied the same way as for REST API entries.

When present, each WebSDK entry may carry a `uiVersion` parsed from the `data-tag="technicalcomponent-ui-c8y"` metadata button (e.g. `1023.0.0`). This acts as an additional semver range filter:
- **Major-only** (`1023.0.0`): included when the major matches anywhere in the upgrade range.
- **Exact version** (`1022.8.3`): included only when strictly after `--from` and at most `--to`.

Each entry is classified by severity and category:

| Category | Detection rule |
|---|---|
| `angular` | Title or body matches `angular N`, `ng update`, `standalone` flag, or `zoneless` — **and** title contains "angular" or "upgrade" |
| `security` | Title/body mentions "security", "XSS", "CSS injection", or "vulnerability" |
| `websdk-ui` | Everything else |

Severity mapping:
- `change-type-api-change` → `BREAKING`
- `change-type-announcement` with title starting `Planned:` → `INFO`
- Everything else → `NOTABLE`

**Angular release notes (live):** [`angular-changelog-fetcher`](src/fetchers/angular-changelog-fetcher.ts)  
**Source:** `https://api.github.com/repos/angular/angular/releases/tags/{N}.0.0`

Whenever the traversal crosses an Angular major version boundary, the CLI fetches the official Angular GitHub release notes directly — for **every** Angular major between the from and to versions (inclusive). For a 2025-lts (Angular 18) → 2026-lts (Angular 20) upgrade this means Angular 19 *and* Angular 20 are fetched, because `ng update @angular/core@20` applies both sets of migration schematics.

Angular releases use a consistent `## Breaking Changes\n### package\n- bullet` format. The parser extracts each bullet per package and adds it as a `BREAKING / angular` entry attributed to the LTS alias that introduced the corresponding Angular major.

---

### 3. REST API breaking changes

**Source:** `https://cumulocity.com/docs/change-logs/` (single global request)  
**Equivalent filter:** `?component=.component-rest-api&change-type=.change-type-api-change`

REST API changes are fetched from the **global** aggregated changelog page rather than year-specific sub-paths. This ensures completeness — entries published during a continuous delivery (CD) window between two LTS releases appear on the global page regardless of which year they were posted under.

Entries are attributed using **npm publish dates** rather than calendar year:

1. The npm registry `time` field records the exact UTC timestamp when each version was published.
2. Each REST API entry has a publish date (from the `data-date` attribute, or falling back to the preceding `<h5>Month DD, YYYY</h5>` section header on the global page).
3. Only entries whose date falls **strictly after** `fromVersion`'s npm release date and **on or before** `toVersion`'s npm release date are included.
4. Each included entry is attributed to the first LTS version whose npm release date is ≥ the entry's publish date — i.e. the LTS that first *ships* the change.

This correctly captures CD-era changes. For example, a REST API change published in September 2025 (after 2025-lts was released in early 2025, but before 2026-lts in early 2026) is attributed to **2026-lts** and appears in a `--from 2025-lts --to 2026-lts` report.

---

This cli is provided as-is and without warranty or support. They do not constitute part of the Cumulocity product suite. Users are free to use, fork and modify them, subject to the license agreement. While Cumulocity welcomes contributions, we cannot guarantee to include every contribution in the master project.

