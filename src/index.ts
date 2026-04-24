#!/usr/bin/env node
/**
 * c8y-breaking-changes — CLI to detect and list breaking changes between
 * Cumulocity Web SDK versions.
 *
 * Data sources:
 *  - Version map: npm dist-tags on @c8y/ngx-components (y????-lts tags)
 *  - WebSDK changes: https://cumulocity.com/docs/{year}/change-logs/
 *  - REST API changes: https://cumulocity.com/docs/change-logs/
 *  - Angular changes: https://api.github.com/repos/angular/angular/releases
 *
 * Usage:
 *   c8y-breaking-changes --from 2024-lts --to 2026-lts
 *   c8y-breaking-changes --from 2025 --to 2026 --format markdown
 *   c8y-breaking-changes --from 1021 --to 1023 --no-npm --show-grep
 */

import { Command, Option } from 'commander';
import { resolveVersion, getVersionRange } from './version-map.js';
import { fetchChangelogs } from './fetchers/github-skills-fetcher.js';
import { fetchAngularBreakingChanges } from './fetchers/angular-changelog-fetcher.js';
import { fetchNpmDerivedData, fetchLatestCdVersion, type NpmVersionInfo } from './npm-fetcher.js';
import { printReport } from './reporter.js';
import type { SdkVersion } from './version-map.js';

// ── LLM / agent schema (emitted by --help-json) ───────────────────────────────

const VERSION_ALIAS_FORMATS = [
  { format: 'LTS alias',           pattern: '<year>-lts',               examples: ['2025-lts', '2026-lts'] },
  { format: 'Year alias',          pattern: '<year> or y<year>',        examples: ['2025', 'y2026'] },
  { format: 'Minor / stable line', pattern: '<major> or <major>.<min>', examples: ['1021', '1021.22'] },
  { format: 'Full patch version',  pattern: '<major>.<min>.<patch>',    examples: ['1021.22.145', '1023.13.2'] },
  { format: 'CD release',          pattern: 'cd',                       examples: ['cd'], note: 'Resolves to the current latest dist-tag on npm (@c8y/ngx-components)' },
] as const;

const CLI_SCHEMA = {
  name: 'c8y-breaking-changes',
  version: '1.0.0',
  description:
    'Detect and list Cumulocity Web SDK breaking changes between two version lines. ' +
    'Version map from npm dist-tags; change data scraped live from cumulocity.com.',
  dataSources: [
    'https://registry.npmjs.org/@c8y/ngx-components (version map)',
    'https://cumulocity.com/docs/{year}/change-logs/ (WebSDK changes)',
    'https://cumulocity.com/docs/change-logs/ (REST API changes)',
    'https://api.github.com/repos/angular/angular/releases (Angular changes)',
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
        { flags: '--no-npm',             required: false, description: 'Skip the npm registry lookup. Omits latest patch version info from the report.' },
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

const program = new Command();

program
  .name('c8y-breaking-changes')
  .description(
    'Detect and list breaking changes between Cumulocity Web SDK versions.\n\n' +
      'Version map: npm dist-tags on @c8y/ngx-components (y????-lts tags)\n' +
      'Changes: cumulocity.com/docs/{year}/change-logs/ and /docs/change-logs/\n\n' +
      'Version alias formats:\n' +
      '  2025-lts          LTS alias\n' +
      '  2025, y2025       Year alias (y-prefix optional)\n' +
      '  1021, 1021.22     Minor / stable line\n' +
      '  1021.22.145       Full patch version (resolved to its LTS line)\n' +
      '  cd                Latest npm dist-tag (@c8y/ngx-components)\n\n' +
      'Tip: run with --help-json to get the full machine-readable CLI schema.',
  )
  .version('1.0.0');

// Handle --help-json before Commander parses — avoids unknown-option errors on subcommands.
if (process.argv.includes('--help-json')) {
  console.log(JSON.stringify(CLI_SCHEMA, null, 2));
  process.exit(0);
}

// ── check (default command) ───────────────────────────────────────────────────

program
  .command('check', { isDefault: true })
  .description(
    'Fetch and report breaking changes between two SDK version lines.\n\n' +
      'Traverses every LTS version between --from and --to (from-exclusive, to-inclusive) and\n' +
      'collects all BREAKING, NOTABLE, and INFO changes from the Cumulocity changelog and Angular release notes.',
  )
  .requiredOption(
    '-f, --from <version>',
    'Your current SDK version (the one you are upgrading FROM). ' +
      'Accepts: LTS alias (2025-lts), year alias (2025, y2025), minor/stable line (1021.22), ' +
      'full patch version (1021.22.50), or "cd" for the latest npm release.',
  )
  .requiredOption(
    '-t, --to <version>',
    'The SDK version you are upgrading TO. Accepts the same formats as --from. ' +
      'Use "cd" to target the current latest dist-tag on npm (@c8y/ngx-components).',
  )
  .addOption(
    new Option(
      '--format <format>',
      '"pretty" renders colour terminal output (default); ' +
        '"json" emits a single valid JSON object suitable for CI scripts and LLM consumption; ' +
        '"markdown" produces GitHub-flavored Markdown for PR comments and Step Summaries.',
    )
      .choices(['pretty', 'json', 'markdown'])
      .default('pretty'),
  )
  .option('--breaking-only', 'Suppress NOTABLE and INFO items — report only BREAKING severity changes.')
  .option(
    '--category <cat>',
    'Narrow output to one change category: angular | websdk-ui | rest-api | security | migration.',
  )
  .option('--show-grep', 'Print grep search patterns alongside each change to help locate affected symbols in your codebase.')
  .option('--no-npm', 'Skip the npm registry lookup. The report will omit latest patch version information.')
  .option('--no-color', 'Disable ANSI colour codes. Useful when piping output or running in a non-TTY environment.')
  .addHelpText(
    'after',
    `
Examples:
  $ c8y-breaking-changes --from 2025-lts --to 2026-lts
  $ c8y-breaking-changes --from 1021.22.50 --to cd --format json
  $ c8y-breaking-changes --from 2024-lts --to 2026-lts --breaking-only --category angular
  $ c8y-breaking-changes --from 2025-lts --to 2026-lts --format markdown

Version alias formats:
  2025-lts          LTS alias
  2025, y2025       Year alias (y-prefix optional)
  1021, 1021.22     Minor / stable line
  1021.22.145       Full patch version (resolved to its LTS line)
  cd                Resolves to the current \`latest\` dist-tag on npm`,
  )
  .action(async (opts) => {
    const { from: fromAlias, to: toAlias, format, npm: doNpm, showGrep, color, breakingOnly, category } = opts;

    const isCd = (s: string) => s.trim().toLowerCase() === 'cd';
    const needsCd = isCd(fromAlias) || isCd(toAlias);

    // ── Phase 1: version map from npm + optional CD version ──────────────────
    process.stderr.write('Fetching version map from npm...');
    let versions: SdkVersion[] = [];
    let npmInfo: NpmVersionInfo = {
      packageName: '@c8y/ngx-components',
      latest: null,
      distTags: {},
      ltsPatchVersions: {},
      angularVersions: {},
    };
    let cdVersion: string | null = null;

    try {
      const [npmData, resolvedCd] = await Promise.all([
        doNpm !== false ? fetchNpmDerivedData() : Promise.resolve(null),
        needsCd ? fetchLatestCdVersion() : Promise.resolve(null),
      ]);
      if (npmData) {
        versions = npmData.versions;
        npmInfo = npmData.npmInfo;
      }
      cdVersion = resolvedCd;
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

    // ── Resolve 'cd' alias to latest npm version ─────────────────────────────
    if (needsCd && !cdVersion) {
      console.error('\nError: could not resolve "cd" — npm registry unreachable.\n');
      process.exit(1);
    }
    const resolvedFromAlias = isCd(fromAlias) ? (cdVersion as string) : fromAlias;
    const resolvedToAlias   = isCd(toAlias)   ? (cdVersion as string) : toAlias;
    if (isCd(fromAlias)) process.stderr.write(`Resolved "cd" (--from) → ${cdVersion}\n`);
    if (isCd(toAlias))   process.stderr.write(`Resolved "cd" (--to)   → ${cdVersion}\n`);

    // ── Resolve version aliases ──────────────────────────────────────────────
    const fromVersion = resolveVersion(resolvedFromAlias, versions);
    const toVersion = resolveVersion(resolvedToAlias, versions);

    if (!fromVersion) {
      console.error(
        `\nError: unrecognised --from value "${resolvedFromAlias}".\n` +
          `  Valid formats: LTS alias (2025-lts), year (2025, y2025), minor (1021.22),\n` +
          `  full patch version (1021.22.145), or "cd" for the latest npm release.\n`,
      );
      printKnownVersions(versions);
      process.exit(1);
    }

    if (!toVersion) {
      console.error(
        `\nError: unrecognised --to value "${resolvedToAlias}".\n` +
          `  Valid formats: LTS alias (2025-lts), year (2025, y2025), minor (1021.22),\n` +
          `  full patch version (1021.22.145), or "cd" for the latest npm release.\n`,
      );
      printKnownVersions(versions);
      process.exit(1);
    }

    // ── Compute traversal range ──────────────────────────────────────────────
    const traversedVersions = getVersionRange(fromVersion, toVersion, versions);

    if (traversedVersions.length === 0) {
      if (fromVersion.ltsAlias === toVersion.ltsAlias) {
        console.error(
          `\nError: --from and --to both resolve to the same version line (${fromVersion.ltsAlias}).\n` +
            `  There are no versions to traverse. Provide a --to that is a newer LTS line.\n`,
        );
      } else {
        console.error(
          `\nError: "${resolvedFromAlias}" (${fromVersion.ltsAlias}) is newer than "${resolvedToAlias}" (${toVersion.ltsAlias}).\n` +
            `  Swap --from and --to.\n`,
        );
      }
      process.exit(1);
    }

    // ── Phase 2: fetch changelog + Angular release notes (parallel) ──────────
    const traversedYears = traversedVersions.map((v) => parseInt(v.yearAlias));

    process.stderr.write('Fetching changelogs + Angular release notes...');

    let prevAngular = fromVersion.angularVersion;
    const angularFetches = traversedVersions.map((v) => {
      const from = prevAngular;
      prevAngular = v.angularVersion;
      return from < v.angularVersion
        ? fetchAngularBreakingChanges(from, v.angularVersion, v.ltsAlias)
        : Promise.resolve<ReturnType<typeof fetchChangelogs> extends Promise<infer T> ? T : never>([]);
    });

    let changelogChanges: Awaited<ReturnType<typeof fetchChangelogs>> = [];
    let angularChangesPerHop: (Awaited<ReturnType<typeof fetchAngularBreakingChanges>>)[] = [];

    try {
      [changelogChanges, ...angularChangesPerHop] = await Promise.all([
        fetchChangelogs(traversedYears, versions),
        ...angularFetches,
      ]);
    } catch (err) {
      process.stderr.write(' failed\n');
      console.error(`\n${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
    process.stderr.write(' done\n');

    // ── Merge and filter ─────────────────────────────────────────────────────
    const targetAliases = new Set(traversedVersions.map((v) => v.ltsAlias));
    let breakingChanges = changelogChanges.filter((c) => targetAliases.has(c.introducedIn));

    const angularChanges = angularChangesPerHop.flat().filter((c) => {
      if (breakingOnly && c.severity !== 'BREAKING') return false;
      if (category && c.category !== category) return false;
      return true;
    });
    breakingChanges = [...breakingChanges, ...angularChanges];

    if (breakingOnly) {
      breakingChanges = breakingChanges.filter((c) => c.severity === 'BREAKING');
    }
    if (category) {
      breakingChanges = breakingChanges.filter((c) => c.category === category);
    }

    // Sort: BREAKING first, then NOTABLE, then INFO; within each: oldest version first
    const severityOrder = { BREAKING: 0, NOTABLE: 1, INFO: 2 };
    const versionOrder = Object.fromEntries(versions.map((v, i) => [v.ltsAlias, i]));
    breakingChanges.sort((a, b) => {
      const sev = severityOrder[a.severity] - severityOrder[b.severity];
      if (sev !== 0) return sev;
      return (versionOrder[a.introducedIn] ?? 99) - (versionOrder[b.introducedIn] ?? 99);
    });

    // ── Print report ──────────────────────────────────────────────────────────
    printReport({
      fromVersion,
      toVersion,
      traversedVersions,
      breakingChanges,
      npmInfo,
      showGrepHints: Boolean(showGrep),
      noColor: !color,
      format: format as 'pretty' | 'json' | 'markdown',
    });
  });

// ── versions command ──────────────────────────────────────────────────────────

program
  .command('versions')
  .description(
    'List all known SDK version aliases, derived from npm dist-tags on @c8y/ngx-components.\n' +
      'Use this command to discover valid --from and --to values for the check command.',
  )
  .addHelpText('after', '\nExamples:\n  $ c8y-breaking-changes versions\n')
  .action(async () => {
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
  });

// ── helpers ───────────────────────────────────────────────────────────────────

function printKnownVersions(versions: SdkVersion[]): void {
  console.log('\nKnown SDK version aliases:\n');
  console.log('  Alias          SDK line    Angular   Status');
  console.log('  ' + '─'.repeat(58));
  for (const v of [...versions].reverse()) {
    const row = [
      v.ltsAlias.padEnd(15),
      v.stableLine.padEnd(12),
      `Angular ${v.angularVersion}`.padEnd(10),
      v.supportStatus,
    ].join('  ');
    console.log('  ' + row);
  }
  console.log('');
}

program.parse();
