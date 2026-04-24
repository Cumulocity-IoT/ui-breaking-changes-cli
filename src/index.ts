#!/usr/bin/env node
/**
 * c8y-breaking-changes — CLI to detect and list breaking changes between
 * Cumulocity Web SDK versions.
 *
 * All data is fetched live from the Cumulocity skills GitHub repository.
 * No breaking change data is hardcoded — run the CLI with network access.
 *
 * Usage:
 *   c8y-breaking-changes --from 2024-lts --to 2026-lts
 *   c8y-breaking-changes --from 2025 --to 2026 --format markdown
 *   c8y-breaking-changes --from 1021 --to 1023 --no-npm --show-grep
 */

import { Command, Option } from 'commander';
import { resolveVersion, getVersionRange } from './version-map.js';
import { fetchCoreSkillsData, fetchMigrationPlans } from './fetchers/github-skills-fetcher.js';
import { fetchNpmVersionInfo, fetchLatestCdVersion, type NpmVersionInfo } from './npm-fetcher.js';
import { printReport } from './reporter.js';
import type { SdkVersion } from './version-map.js';

const program = new Command();

program
  .name('c8y-breaking-changes')
  .description(
    'Detect and list breaking changes between Cumulocity Web SDK versions.\n\n' +
      'Data is fetched live from https://github.com/Cumulocity-IoT/cumulocity-skills\n\n' +
      'Version aliases accepted:\n' +
      '  • LTS aliases:   2023-lts, 2024-lts, 2025-lts, 2026-lts\n' +
      '  • Year aliases:  2023, 2024, 2025, 2026  (or y2025 etc.)\n' +
      '  • Minor version: 1017, 1018, 1021, 1023, 1021.22\n' +
      '  • CD release:    cd  (resolves to the latest npm release)\n',
  )
  .version('1.0.0');

// ── check (default command) ───────────────────────────────────────────────────

program
  .command('check', { isDefault: true })
  .description('Check breaking changes between two SDK versions')
  .requiredOption('-f, --from <version>', 'Source (current) SDK version or LTS alias')
  .requiredOption('-t, --to <version>', 'Target SDK version or LTS alias')
  .addOption(
    new Option('--format <format>', 'Output format')
      .choices(['pretty', 'json', 'markdown'])
      .default('pretty'),
  )
  .option('--no-npm', 'Skip npm registry fetch')
  .option('--show-grep', 'Show grep hints for locating affected code')
  .option('--no-color', 'Disable colour output')
  .option('--breaking-only', 'Show only BREAKING severity items (hide NOTABLE / INFO)')
  .option(
    '--category <cat>',
    'Filter by category: angular, websdk-ui, rest-api, security, migration',
  )
  .action(async (opts) => {
    const { from: fromAlias, to: toAlias, format, npm: doNpm, showGrep, color, breakingOnly, category } = opts;

    const isCd = (s: string) => s.trim().toLowerCase() === 'cd';
    const needsCd = isCd(fromAlias) || isCd(toAlias);

    // ── Phase 1: fetch core skills + optional CD version (parallel) ──────────
    process.stderr.write('Fetching skills from GitHub...');
    let coreData: Awaited<ReturnType<typeof fetchCoreSkillsData>>;
    let cdVersion: string | null = null;
    try {
      [coreData, cdVersion] = await Promise.all([
        fetchCoreSkillsData(),
        needsCd ? fetchLatestCdVersion() : Promise.resolve(null),
      ]);
    } catch (err) {
      process.stderr.write(' failed\n');
      console.error(`\n${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
    process.stderr.write(' done\n');

    // ── Resolve 'cd' alias to latest npm version ─────────────────────────────
    if (needsCd && !cdVersion) {
      console.error('\nError: could not resolve "cd" — npm registry unreachable.\n');
      process.exit(1);
    }
    const resolvedFromAlias = isCd(fromAlias) ? (cdVersion as string) : fromAlias;
    const resolvedToAlias   = isCd(toAlias)   ? (cdVersion as string) : toAlias;
    if (isCd(fromAlias)) process.stderr.write(`Resolved "cd" (--from) → ${cdVersion}\n`);
    if (isCd(toAlias))   process.stderr.write(`Resolved "cd" (--to)   → ${cdVersion}\n`);

    const { versions, changes: allChanges } = coreData;

    // ── Resolve version aliases ──────────────────────────────────────────────
    const fromVersion = resolveVersion(resolvedFromAlias, versions);
    const toVersion = resolveVersion(resolvedToAlias, versions);

    if (!fromVersion) {
      console.error(`\nError: unknown version alias "${resolvedFromAlias}"\n`);
      printKnownVersions(versions);
      process.exit(1);
    }

    if (!toVersion) {
      console.error(`\nError: unknown version alias "${resolvedToAlias}"\n`);
      printKnownVersions(versions);
      process.exit(1);
    }

    // ── Compute traversal range ──────────────────────────────────────────────
    const traversedVersions = getVersionRange(fromVersion, toVersion, versions);

    if (traversedVersions.length === 0) {
      if (fromVersion.ltsAlias === toVersion.ltsAlias) {
        console.error('\nError: --from and --to are the same version.\n');
      } else {
        console.error(
          `\nError: "${resolvedFromAlias}" is newer than "${resolvedToAlias}". Swap --from and --to.\n`,
        );
      }
      process.exit(1);
    }

    // ── Filter breaking changes to the traversal range ───────────────────────
    const targetAliases = new Set(traversedVersions.map((v) => v.ltsAlias));
    let breakingChanges = allChanges.filter((c) => targetAliases.has(c.introducedIn));

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

    // ── Phase 2: fetch migration plans for traversed versions ────────────────
    process.stderr.write('Fetching migration guides...');
    const migrationPlan = await fetchMigrationPlans(
      traversedVersions.map((v) => v.ltsAlias),
      versions,
    );
    process.stderr.write(' done\n');

    // ── Phase 3: fetch npm info (optional) ───────────────────────────────────
    let npmInfo: NpmVersionInfo = {
      packageName: '@c8y/ngx-components',
      latest: null,
      distTags: {},
      ltsPatchVersions: {},
    };

    if (doNpm !== false) {
      process.stderr.write('Fetching npm version info...');
      npmInfo = await fetchNpmVersionInfo(versions.map((v) => v.stableLine));
      process.stderr.write(' done\n');
    }

    // ── Print report ──────────────────────────────────────────────────────────
    printReport({
      fromVersion,
      toVersion,
      traversedVersions,
      breakingChanges,
      migrationPlan,
      npmInfo,
      showGrepHints: Boolean(showGrep),
      noColor: !color,
      format: format as 'pretty' | 'json' | 'markdown',
    });
  });

// ── versions command ──────────────────────────────────────────────────────────

program
  .command('versions')
  .description('List all known SDK version aliases (fetched live from GitHub)')
  .action(async () => {
    process.stderr.write('Fetching version map from GitHub...');
    let versions: SdkVersion[];
    try {
      const { versions: v } = await fetchCoreSkillsData();
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
