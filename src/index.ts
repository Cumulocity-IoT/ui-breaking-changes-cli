#!/usr/bin/env node
/**
 * c8y-breaking-changes — CLI to detect and list breaking changes between
 * Cumulocity Web SDK versions.
 *
 * Data sources:
 *  - Version map: npm dist-tags on @c8y/ngx-components (y????-lts tags)
 *  - Changelogs: https://cumulocity.com/docs/change-logs/ (WebSDK and REST API — single global page)
 *  - Angular changes: https://api.github.com/repos/angular/angular/releases
 *
 * Usage:
 *   c8y-breaking-changes --from 2024-lts --to 2026-lts
 *   c8y-breaking-changes --from 2025 --to 2026 --format markdown
 *   c8y-breaking-changes --from 1021 --to 1023 --show-grep
 */

import { defineCommand, runMain } from 'citty';
import { createRequire } from 'node:module';

const { version: PKG_VERSION } = createRequire(import.meta.url)('../package.json') as { version: string };

import { getVersionRange } from './version-map.js';
import { fetchChangelogs } from './fetchers/c8y-changelog-fetcher.js';
import { fetchAngularBreakingChanges } from './fetchers/angular-changelog-fetcher.js';
import { fetchNpmDerivedData, resolveArbitraryVersion, type NpmVersionInfo } from './npm-fetcher.js';
import { printReport } from './reporter.js';
import { compareSemver } from './utils.js';
import type { SdkVersion } from './version-map.js';

// ── LLM / agent schema (emitted by --help-json) ───────────────────────────────

const VERSION_ALIAS_FORMATS = [
  { format: 'LTS alias',           pattern: '<year>-lts',               examples: ['2025-lts', '2026-lts'] },
  { format: 'Year alias',          pattern: '<year> or y<year>',        examples: ['2025', 'y2026'] },
  { format: 'Stable line',         pattern: '<major>.<min>',           examples: ['1021.22', '1023.14'], note: 'Must be an exact LTS stable-line match. Bare majors (e.g. "1021") require the @oldest/@latest qualifier.' },
  { format: 'Full patch version',  pattern: '<major>.<min>.<patch>',    examples: ['1021.22.145', '1023.13.2'] },
  { format: 'Range selector',      pattern: '<prefix>@oldest|<prefix>@latest', examples: ['1021@oldest', '1021@latest', '1021.22@latest'], note: 'Picks the first or last published patch within the given major (or major.minor) prefix. Required for partial version inputs.' },
  { format: 'CD release',          pattern: 'cd',                       examples: ['cd'], note: 'Resolves to the current latest dist-tag on npm (@c8y/ngx-components)' },
] as const;

const CLI_SCHEMA = {
  name: 'c8y-breaking-changes',
  version: PKG_VERSION,
  description:
    'Detect and list Cumulocity Web SDK breaking changes between two version lines. ' +
    'Version map from npm dist-tags; change data scraped live from cumulocity.com.',
  dataSources: [
    'https://registry.npmjs.org/@c8y/ngx-components (version map, release dates, Angular peer deps)',
    'https://cumulocity.com/docs/change-logs/ (WebSDK and REST API changes — single global page)',
    'https://api.github.com/repos/angular/angular/releases (Angular release notes, fetched per major version crossed)',
  ],
  versionAliasFormats: VERSION_ALIAS_FORMATS,
  commands: [
    {
      name: 'check',
      isDefault: true,
      description:
        'Fetch and report all breaking, notable, and informational changes introduced between ' +
        '--from and --to. Traverses every LTS version in the range (from-exclusive, to-inclusive).',
      options: [
        { flags: '-f, --from <version>', required: true,  description: 'Your current SDK version (upgrading FROM). Accepts LTS alias, year alias, minor, full patch, or "cd".', formats: VERSION_ALIAS_FORMATS },
        { flags: '-t, --to <version>',   required: true,  description: 'The SDK version you are upgrading TO. Same formats as --from. Use "cd" for the current npm latest release.', formats: VERSION_ALIAS_FORMATS },
        { flags: '--format <format>',    required: false, choices: ['pretty', 'json', 'markdown'], default: 'pretty', description: '"json" emits a single valid JSON object; "markdown" produces GitHub-flavored Markdown; "pretty" renders coloured terminal output.' },
        { flags: '--breaking-only',      required: false, description: 'Show only BREAKING severity changes; suppress NOTABLE and INFO.' },
        { flags: '--category <cat>',     required: false, choices: ['angular', 'websdk-ui', 'rest-api', 'security', 'migration'], description: 'Filter output to a single change category.' },
        { flags: '--show-grep',          required: false, description: 'Print grep search patterns for each change to locate affected symbols in your codebase.' },
        { flags: '--no-color',           required: false, description: 'Disable ANSI colour codes. Useful when piping output or running in a non-TTY environment.' },
        { flags: '--help-json',          required: false, hidden: true, description: 'Output the full CLI schema as JSON for programmatic or LLM use, then exit.' },
      ],
      examples: [
        { description: 'Check all changes between two LTS lines (terminal output)',       command: 'c8y-breaking-changes --from 2025-lts --to 2026-lts' },
        { description: 'CI/CD: compare pinned version to latest CD release, output JSON', command: 'c8y-breaking-changes --from 1021.22.50 --to cd --format json' },
        { description: 'Only BREAKING changes, filtered to the Angular upgrade category', command: 'c8y-breaking-changes --from 2024-lts --to 2026-lts --breaking-only --category angular' },
        { description: 'Generate a Markdown report for a GitHub PR comment',              command: 'c8y-breaking-changes --from 2025-lts --to 2026-lts --format markdown' },
      ],
    },
    {
      name: 'versions',
      description: 'List all known SDK version aliases derived from npm dist-tags on @c8y/ngx-components.',
      examples: [
        { description: 'Discover valid --from and --to values', command: 'c8y-breaking-changes versions' },
      ],
    },
  ],
};

// ── helpers ───────────────────────────────────────────────────────────────────

function printKnownVersions(versions: SdkVersion[]): void {
  const aliasW = Math.max('Alias'.length,    ...versions.map((v) => v.ltsAlias.length));
  const lineW  = Math.max('SDK line'.length, ...versions.map((v) => v.stableLine.length));
  const angW   = Math.max('Angular'.length,  ...versions.map((v) => `Angular ${v.angularVersion}`.length));

  console.log('\nKnown SDK version aliases:\n');
  console.log(
    `  ${['Alias'.padEnd(aliasW), 'SDK line'.padEnd(lineW), 'Angular'.padEnd(angW), 'Status'].join('  ')}`,
  );
  console.log(`  ${'─'.repeat(aliasW + lineW + angW + 16)}`);
  for (const v of versions.concat().reverse()) {
    const row = [
      v.ltsAlias.padEnd(aliasW),
      v.stableLine.padEnd(lineW),
      `Angular ${v.angularVersion}`.padEnd(angW),
      v.supportStatus,
    ].join('  ');
    console.log(`  ${row}`);
  }
  console.log('');
}

// ── Shared check args (no --help-json — root-only, kept out of check --help) ──

const CHECK_ARGS = {
  from: {
    type: 'string' as const,
    alias: 'f',
    description:
      'Your current SDK version (the one you are upgrading FROM). ' +
      'Accepts: LTS alias (2025-lts), year alias (2025, y2025), minor/stable line (1021.22), ' +
      'full patch version (1021.22.50), or "cd" for the latest npm release.',
  },
  to: {
    type: 'string' as const,
    alias: 't',
    description:
      'The SDK version you are upgrading TO. Accepts the same formats as --from. ' +
      'Use "cd" to target the current latest dist-tag on npm (@c8y/ngx-components).',
  },
  format: {
    type: 'string' as const,
    default: 'pretty',
    description:
      '"pretty" renders colour terminal output (default); ' +
      '"json" emits a single valid JSON object suitable for CI scripts and LLM consumption; ' +
      '"markdown" produces GitHub-flavored Markdown for PR comments and Step Summaries.',
  },
  'breaking-only': {
    type: 'boolean' as const,
    default: false,
    description: 'Suppress NOTABLE and INFO items — report only BREAKING severity changes.',
  },
  category: {
    type: 'string' as const,
    description: 'Narrow output to one change category: angular | websdk-ui | rest-api | security | migration.',
  },
  'show-grep': {
    type: 'boolean' as const,
    default: false,
    description: 'Print grep search patterns alongside each change to help locate affected symbols in your codebase.',
  },
  'no-color': {
    type: 'boolean' as const,
    default: false,
    description: 'Disable ANSI colour codes. Useful when piping output or running in a non-TTY environment.',
  },
} as const;

type CheckArgs = {
  from?: string;
  to?: string;
  format: string;
  'breaking-only': boolean;
  category?: string;
  'show-grep': boolean;
  'no-color': boolean;
};

// ── Shared check logic ────────────────────────────────────────────────────────

async function runCheck(args: CheckArgs): Promise<void> {
  const fromAlias = args.from;
  const toAlias   = args.to;

  if (!fromAlias || !toAlias) {
    console.error(
      '\nError: --from and --to are required.\n\n' +
        'Usage: c8y-breaking-changes --from <version> --to <version>\n\n' +
        'Examples:\n' +
        '  c8y-breaking-changes --from 2025-lts --to 2026-lts\n' +
        '  c8y-breaking-changes --from 1021.22.50 --to cd --format json\n\n' +
        'Run "c8y-breaking-changes --help" for full usage.\n',
    );
    process.exit(1);
  }

  // Validate --format
  const validFormats = ['pretty', 'json', 'markdown'];
  if (!validFormats.includes(args.format)) {
    console.error(
      `\nError: invalid --format "${args.format}". Choose one of: pretty, json, markdown.\n`,
    );
    process.exit(1);
  }

  const isCd = (s: string) => s.trim().toLowerCase() === 'cd';
  const needsCd = isCd(fromAlias) || isCd(toAlias);

  // ── Phase 1: version map from npm + optional CD version ────────────────────
  process.stderr.write('Fetching version map from npm...');
  let versions: SdkVersion[] = [];
  let npmInfo: NpmVersionInfo = {
    packageName: '@c8y/ngx-components',
    latest: null,
    distTags: {},
    ltsPatchVersions: {},
    angularVersions: {},
  };
  let manifest: import('./schemas.js').NpmPackageManifest | null = null;
  let cdVersion: string | null = null;

  try {
    const npmData = await fetchNpmDerivedData();
    versions = npmData.versions;
    manifest = npmData.manifest;
    npmInfo = npmData.npmInfo;
    if (needsCd) {
      cdVersion = npmData.npmInfo.distTags.latest ?? null;
    }
  } catch (err) {
    process.stderr.write(' failed\n');
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
  process.stderr.write(' done\n');

  if (versions.length === 0) {
    console.error(
      '\nError: could not build version map — npm registry unreachable or returned no y????-lts dist-tags.\n',
    );
    process.exit(1);
  }

  if (needsCd && !cdVersion) {
    console.error('\nError: could not resolve "cd" — npm registry unreachable.\n');
    process.exit(1);
  }
  const resolvedFromAlias = isCd(fromAlias) ? (cdVersion as string) : fromAlias;
  const resolvedToAlias   = isCd(toAlias)   ? (cdVersion as string) : toAlias;
  if (isCd(fromAlias)) process.stderr.write(`Resolved "cd" (--from) → ${cdVersion}\n`);
  if (isCd(toAlias))   process.stderr.write(`Resolved "cd" (--to)   → ${cdVersion}\n`);

  // ── Resolve version aliases ────────────────────────────────────────────────
  const fromVersion = resolveArbitraryVersion(resolvedFromAlias, versions, manifest);
  const toVersion   = resolveArbitraryVersion(resolvedToAlias,   versions, manifest);

  if (!fromVersion) {
    console.error(
      `\nError: unrecognised --from value "${resolvedFromAlias}".\n` +
        `  Could not find this version on npm.\n` +
        `  Valid formats: LTS alias (2025-lts), year (2025, y2025), stable line (1021.22),\n` +
        `  full patch (1021.22.145), range selector (1021@oldest, 1021@latest), or "cd".\n`,
    );
    printKnownVersions(versions);
    process.exit(1);
  }

  if (!toVersion) {
    console.error(
      `\nError: unrecognised --to value "${resolvedToAlias}".\n` +
        `  Could not find this version on npm.\n` +
        `  Valid formats: LTS alias (2025-lts), year (2025, y2025), stable line (1021.22),\n` +
        `  full patch (1021.22.145), range selector (1021@oldest, 1021@latest), or "cd".\n`,
    );
    printKnownVersions(versions);
    process.exit(1);
  }

  // ── Validate version ordering ──────────────────────────────────────────────
  if (compareSemver(toVersion.version, fromVersion.version) <= 0) {
    console.error(
      `\nError: --to "${resolvedToAlias}" (${toVersion.version}) is not newer than --from "${resolvedFromAlias}" (${fromVersion.version}).\n` +
        `  Swap --from and --to.\n`,
    );
    process.exit(1);
  }
  if (
    fromVersion.releaseDate &&
    toVersion.releaseDate &&
    new Date(toVersion.releaseDate) <= new Date(fromVersion.releaseDate)
  ) {
    process.stderr.write(
      `[warning] --to "${resolvedToAlias}" (${toVersion.version}) has an earlier or equal release date than --from "${resolvedFromAlias}" (${fromVersion.version}). Changelog results may be incomplete.\n`,
    );
  }

  // ── Compute traversal range ────────────────────────────────────────────────
  const traversedVersions = getVersionRange(fromVersion, toVersion, versions);

  // ── Phase 2: fetch changelog + Angular release notes (parallel) ────────────
  process.stderr.write('Fetching changelogs + Angular release notes...');

  const angularFetch = fromVersion.angularVersion < toVersion.angularVersion
    ? fetchAngularBreakingChanges(fromVersion.angularVersion, toVersion.angularVersion, toVersion.ltsAlias ?? toVersion.version)
    : Promise.resolve([] as Awaited<ReturnType<typeof fetchAngularBreakingChanges>>);

  let changelogChanges: Awaited<ReturnType<typeof fetchChangelogs>> = [];
  let angularChangesRaw: Awaited<ReturnType<typeof fetchAngularBreakingChanges>> = [];

  try {
    [changelogChanges, angularChangesRaw] = await Promise.all([
      fetchChangelogs(fromVersion, toVersion, versions),
      angularFetch,
    ]);
  } catch (err) {
    process.stderr.write(' failed\n');
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
  process.stderr.write(' done\n');

  // ── Merge and filter ───────────────────────────────────────────────────────
  let breakingChanges = changelogChanges.concat(angularChangesRaw);

  if (args['breaking-only']) {
    breakingChanges = breakingChanges.filter((c) => c.severity === 'BREAKING');
  }
  if (args.category) {
    breakingChanges = breakingChanges.filter((c) => c.category === args.category);
  }

  // Sort: BREAKING first, then NOTABLE, then INFO; within each: oldest version first
  const severityOrder = { BREAKING: 0, NOTABLE: 1, INFO: 2 };
  const versionOrder = Object.fromEntries(versions.map((v, i) => [v.ltsAlias, i]));
  breakingChanges.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    return (versionOrder[a.introducedIn ?? ''] ?? 99) - (versionOrder[b.introducedIn ?? ''] ?? 99);
  });

  // ── Print report ────────────────────────────────────────────────────────────
  printReport({
    fromVersion,
    toVersion,
    traversedVersions,
    breakingChanges,
    npmInfo,
    showGrepHints: Boolean(args['show-grep']),
    noColor: Boolean(args['no-color']),
    format: args.format as 'pretty' | 'json' | 'markdown',
  });
}

// ── check subcommand (explicit `c8y-breaking-changes check ...` usage) ────────

const checkCommand = defineCommand({
  meta: {
    description:
      'Fetch and report breaking changes between two SDK version lines.\n\n' +
      'Traverses every LTS version between --from and --to (from-exclusive, to-inclusive) and\n' +
      'collects all BREAKING, NOTABLE, and INFO changes from the Cumulocity changelog and Angular release notes.',
  },
  args: CHECK_ARGS,
  async run({ args }) {
    await runCheck(args);
  },
});

// ── versions subcommand ───────────────────────────────────────────────────────

const versionsCommand = defineCommand({
  meta: {
    description:
      'List all known SDK version aliases, derived from npm dist-tags on @c8y/ngx-components.\n' +
      'Use this command to discover valid --from and --to values for the check command.',
  },
  async run() {
    process.stderr.write('Fetching version map from npm...');
    let versions: SdkVersion[];
    try {
      const { versions: v } = await fetchNpmDerivedData();
      versions = v;
      process.stderr.write(' done\n');
    } catch (err) {
      process.stderr.write(' failed\n');
      console.error(`\n${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
    printKnownVersions(versions);
  },
});

// ── Root command (default — runs check when no subcommand given) ──────────────

const main = defineCommand({
  meta: {
    name: 'c8y-breaking-changes',
    version: PKG_VERSION,
    description:
      'Detect and list breaking changes between Cumulocity Web SDK versions.\n\n' +
      'Version map: npm dist-tags on @c8y/ngx-components (y????-lts tags)\n' +
      'Changes: cumulocity.com/docs/change-logs/ (WebSDK and REST API)\n\n' +
      'Version alias formats:\n' +
      '  2025-lts          LTS alias\n' +
      '  2025, y2025       Year alias (y-prefix optional)\n' +
      '  1021.22           Stable line (exact LTS minor match only)\n' +
      '  1021.22.145       Full patch version\n' +
      '  1021@oldest       Oldest published patch in 1021.x.x\n' +
      '  1021@latest       Latest published patch in 1021.x.x\n' +
      '  1021.22@latest    Latest published patch in 1021.22.x\n' +
      '  cd                Latest npm dist-tag (@c8y/ngx-components)\n\n' +
      'Tip: run with --help-json to get the full machine-readable CLI schema.',
  },
  args: {
    ...CHECK_ARGS,
    // --help-json is root-only so it does not appear in `check --help`
    'help-json': {
      type: 'boolean' as const,
      default: false,
      description: 'Output the full CLI schema as JSON for programmatic or LLM use, then exit.',
    },
  },
  subCommands: {
    check: checkCommand,
    versions: versionsCommand,
  },
  async run({ args }) {
    if (args['help-json']) {
      console.log(JSON.stringify(CLI_SCHEMA, null, 2));
      process.exit(0);
    }
    await runCheck(args);
  },
});

runMain(main);
