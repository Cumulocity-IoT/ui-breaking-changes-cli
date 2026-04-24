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
| `-f, --from <version>` | Source (current) SDK version **(required)** |
| `-t, --to <version>` | Target SDK version **(required)** |
| `--format <format>` | Output format: `pretty` (default), `json`, `markdown` |
| `--no-npm` | Skip npm registry fetch |
| `--show-grep` | Show grep hints for locating affected code in your project |
| `--no-color` | Disable colour output |
| `--breaking-only` | Show only `BREAKING` severity items |
| `--category <cat>` | Filter by category: `angular`, `websdk-ui`, `rest-api`, `security`, `migration` |

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
  index.ts                          # CLI entry point (Commander)
  version-map.ts                    # SdkVersion type + resolveVersion / getVersionRange
  version-map.test.ts               # Unit tests (node:test)
  npm-fetcher.ts                    # npm registry fetch (latest patch versions, CD release)
  changelog-fetcher.ts              # Best-effort live changelog page fetch
  reporter.ts                       # Output formatting (pretty / json / markdown)
  data/
    breaking-changes.ts             # Type definitions only (no hardcoded data)
  fetchers/
    github-skills-fetcher.ts        # Fetches + parses all data from cumulocity-skills
.github/
  workflows/
    check-breaking-changes.yml      # GitHub Actions workflow
```

### Data sources

| Source | What it provides |
|---|---|
| `Cumulocity-IoT/cumulocity-skills` | Version map, breaking change changelog, migration guides |
| `registry.npmjs.org/@c8y/ngx-components` | Latest patch versions per LTS line, CD (`latest`) release |
