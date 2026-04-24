/**
 * Formats and prints the breaking-changes report to stdout.
 *
 * Uses chalk for colour; degrades gracefully when colours are disabled.
 */

import chalk from 'chalk';
import type { SdkVersion } from './version-map.js';
import type { BreakingChange, Category } from './data/breaking-changes.js';
import type { NpmVersionInfo } from './npm-fetcher.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReportOptions {
  fromVersion: SdkVersion;
  toVersion: SdkVersion;
  /** All versions traversed (from exclusive, to inclusive) */
  traversedVersions: SdkVersion[];
  breakingChanges: BreakingChange[];
  npmInfo: NpmVersionInfo;
  /** When true, print the grep hints */
  showGrepHints: boolean;
  /** When true, suppress colour */
  noColor: boolean;
  /** Output format */
  format: 'pretty' | 'json' | 'markdown';
}

export function printReport(opts: ReportOptions): void {
  if (opts.noColor) {
    chalk.level = 0;
  }

  switch (opts.format) {
    case 'json':
      printJson(opts);
      break;
    case 'markdown':
      printMarkdown(opts);
      break;
    default:
      printPretty(opts);
  }
}

// ---------------------------------------------------------------------------
// Pretty (terminal) output
// ---------------------------------------------------------------------------

function printPretty(opts: ReportOptions): void {
  const { fromVersion, toVersion, traversedVersions, breakingChanges, npmInfo } = opts;

  console.log('');
  console.log(
    chalk.bold.cyan('╔══════════════════════════════════════════════════════════════╗'),
  );
  console.log(
    chalk.bold.cyan('║') +
      chalk.bold.white('  Cumulocity Web SDK — Breaking Changes Report               ') +
      chalk.bold.cyan('║'),
  );
  console.log(
    chalk.bold.cyan('╚══════════════════════════════════════════════════════════════╝'),
  );
  console.log('');

  // ── Summary header ────────────────────────────────────────────────────────
  console.log(chalk.bold('  Upgrade path:'));
  console.log(
    `    ${chalk.yellow(fromVersion.ltsAlias)} (SDK ${fromVersion.stableLine}.x, Angular ${fromVersion.angularVersion})` +
      chalk.gray(' → ') +
      `${chalk.green(toVersion.ltsAlias)} (SDK ${toVersion.stableLine}.x, Angular ${toVersion.angularVersion})`,
  );
  console.log('');

  if (traversedVersions.length === 0) {
    console.log(chalk.yellow('  ⚠  No versions in the upgrade path. Are from/to versions the same or in reverse order?'));
    return;
  }

  console.log(chalk.bold('  Versions traversed:'));
  for (const v of traversedVersions) {
    const latestPatch =
      npmInfo.ltsPatchVersions[v.stableLine] ??
      npmInfo.ltsPatchVersions[v.stableLine.split('.')[0]] ??
      null;

    const patchLabel = latestPatch ? chalk.dim(` (latest patch: ${latestPatch})`) : '';
    console.log(`    ${chalk.green('•')} ${chalk.bold(v.ltsAlias)} — SDK ${v.stableLine}.x, Angular ${v.angularVersion}${patchLabel}`);
  }

  if (npmInfo.latest) {
    console.log('');
    console.log(chalk.dim(`  npm @c8y/ngx-components latest: ${npmInfo.latest}`));
  }

  console.log('');

  // ── Breaking changes by category ──────────────────────────────────────────
  const categories: { key: Category; label: string; icon: string }[] = [
    { key: 'angular', label: 'Angular Upgrade Requirements', icon: '🔺' },
    { key: 'websdk-ui', label: 'WebSDK UI Breaking Changes', icon: '🖥️ ' },
    { key: 'rest-api', label: 'REST API / @c8y/client Changes', icon: '🔗' },
    { key: 'security', label: 'Security Fixes', icon: '🔒' },
    { key: 'migration', label: 'Migration Steps', icon: '📋' },
  ];

  for (const { key, label, icon } of categories) {
    const items = breakingChanges.filter((c) => c.category === key);
    if (items.length === 0) continue;

    console.log(chalk.bold(`  ${icon}  ${label}`));
    console.log(chalk.dim('  ' + '─'.repeat(62)));

    for (const item of items) {
      printChangeItem(item, opts);
    }

    console.log('');
  }

  // ── Reference links ────────────────────────────────────────────────────────
  console.log(chalk.bold('  📚  Reference Links'));
  console.log(chalk.dim('  ' + '─'.repeat(62)));
  console.log(`  ${chalk.underline('https://cumulocity.com/codex/migration-guides/updating-web-sdk-version/overview')}`);
  console.log(`  ${chalk.underline('https://cumulocity.com/docs/change-logs/?component=.component-rest-api&change-type=.change-type-api-change')}`);

  for (const v of traversedVersions) {
    console.log(`  ${chalk.underline(v.changelogUrl)}`);
  }

  console.log(`  ${chalk.underline('https://angular.dev/update-guide')}`);
  console.log('');

  // ── Summary counts ─────────────────────────────────────────────────────────
  const breaking = breakingChanges.filter((c) => c.severity === 'BREAKING').length;
  const notable = breakingChanges.filter((c) => c.severity === 'NOTABLE').length;
  const info = breakingChanges.filter((c) => c.severity === 'INFO').length;

  console.log(chalk.bold('  Summary'));
  console.log(chalk.dim('  ' + '─'.repeat(62)));
  console.log(`  ${chalk.red('●')} BREAKING : ${chalk.bold(breaking)}`);
  console.log(`  ${chalk.yellow('●')} NOTABLE  : ${chalk.bold(notable)}`);
  console.log(`  ${chalk.blue('●')} INFO     : ${chalk.bold(info)}`);
  console.log('');
}

function printChangeItem(item: BreakingChange, opts: ReportOptions): void {
  const badge = severityBadge(item.severity);
  const versionLabel = chalk.dim(`[${item.introducedIn}]`);

  console.log('');
  console.log(`  ${badge} ${chalk.bold(item.title)} ${versionLabel}`);
  console.log(`    ${chalk.gray(item.description)}`);
  if (item.actionRequired) {
    console.log(`    ${chalk.bold('Action:')} ${item.actionRequired}`);
  }

  if (opts.showGrepHints && item.grepHints?.length) {
    console.log(`    ${chalk.dim('Grep for:')} ${item.grepHints.map((g) => chalk.cyan(g)).join('  ')}`);
  }

  if (item.sourceUrl) {
    console.log(`    ${chalk.dim('→')} ${chalk.underline(item.sourceUrl)}`);
  }
}

function severityBadge(severity: BreakingChange['severity']): string {
  switch (severity) {
    case 'BREAKING':
      return chalk.bgRed.white(' BREAKING ');
    case 'NOTABLE':
      return chalk.bgYellow.black(' NOTABLE  ');
    case 'INFO':
      return chalk.bgBlue.white('  INFO    ');
  }
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

function printJson(opts: ReportOptions): void {
  const output = {
    from: {
      alias: opts.fromVersion.ltsAlias,
      sdkLine: opts.fromVersion.stableLine,
      angularVersion: opts.fromVersion.angularVersion,
    },
    to: {
      alias: opts.toVersion.ltsAlias,
      sdkLine: opts.toVersion.stableLine,
      angularVersion: opts.toVersion.angularVersion,
    },
    npm: {
      latest: opts.npmInfo.latest,
      ltsPatchVersions: opts.npmInfo.ltsPatchVersions,
    },
    breakingChanges: opts.breakingChanges,
  };
  console.log(JSON.stringify(output, null, 2));
}

// ---------------------------------------------------------------------------
// Markdown output
// ---------------------------------------------------------------------------

function printMarkdown(opts: ReportOptions): void {
  const { fromVersion, toVersion, traversedVersions, breakingChanges, npmInfo } = opts;

  const lines: string[] = [];

  lines.push('# Cumulocity Web SDK — Breaking Changes Report');
  lines.push('');
  lines.push(
    `**Upgrade path:** \`${fromVersion.ltsAlias}\` (SDK ${fromVersion.stableLine}.x, Angular ${fromVersion.angularVersion}) → \`${toVersion.ltsAlias}\` (SDK ${toVersion.stableLine}.x, Angular ${toVersion.angularVersion})`,
  );
  lines.push('');

  lines.push('## Versions Traversed');
  lines.push('');
  for (const v of traversedVersions) {
    const latestPatch = npmInfo.ltsPatchVersions[v.stableLine] ?? 'unknown';
    lines.push(`- **${v.ltsAlias}** — SDK ${v.stableLine}.x, Angular ${v.angularVersion} (latest patch: \`${latestPatch}\`)`);
  }
  lines.push('');

  const categories: { key: Category; label: string }[] = [
    { key: 'angular', label: 'Angular Upgrade Requirements' },
    { key: 'websdk-ui', label: 'WebSDK UI Breaking Changes' },
    { key: 'rest-api', label: 'REST API / @c8y/client Changes' },
    { key: 'security', label: 'Security Fixes' },
  ];

  for (const { key, label } of categories) {
    const items = breakingChanges.filter((c) => c.category === key);
    if (items.length === 0) continue;

    lines.push(`## ${label}`);
    lines.push('');

    for (const item of items) {
      lines.push(`### ${severityEmoji(item.severity)} ${item.title}`);
      lines.push('');
      lines.push(`**Introduced in:** \`${item.introducedIn}\``);
      lines.push('');
      lines.push(item.description);
      lines.push('');
      if (item.actionRequired) {
        lines.push(`**Action required:** ${item.actionRequired}`);
      }

      if (opts.showGrepHints && item.grepHints?.length) {
        lines.push('');
        lines.push(`**Search for:** ${item.grepHints.map((g) => `\`${g}\``).join(', ')}`);
      }

      if (item.sourceUrl) {
        lines.push('');
        lines.push(`**Source:** ${item.sourceUrl}`);
      }

      lines.push('');
    }
  }

  lines.push('## Reference Links');
  lines.push('');
  lines.push('- [Migration Guide](https://cumulocity.com/codex/migration-guides/updating-web-sdk-version/overview)');
  lines.push('- [REST API Changelog](https://cumulocity.com/docs/change-logs/?component=.component-rest-api&change-type=.change-type-api-change)');
  lines.push('- [Angular Update Guide](https://angular.dev/update-guide)');

  for (const v of traversedVersions) {
    lines.push(`- [${v.ltsAlias} WebSDK Changelog](${v.changelogUrl})`);
  }

  console.log(lines.join('\n'));
}

function severityEmoji(severity: BreakingChange['severity']): string {
  switch (severity) {
    case 'BREAKING':
      return '🔴';
    case 'NOTABLE':
      return '🟡';
    case 'INFO':
      return '🔵';
  }
}
