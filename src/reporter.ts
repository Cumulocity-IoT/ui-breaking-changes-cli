/**
 * Formats and prints the breaking-changes report to stdout.
 *
 * Uses chalk for colour; degrades gracefully when colours are disabled.
 */

import chalk from 'chalk';
import type { InputVersion, SdkVersion } from './version-map.js';
import type { BreakingChange, Category } from './data/breaking-changes.js';
import type { NpmVersionInfo } from './npm-fetcher.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReportOptions {
  fromVersion: InputVersion;
  toVersion: InputVersion;
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
    `    ${chalk.yellow(versionLabel(fromVersion))}` +
      chalk.gray(' → ') +
      chalk.green(versionLabel(toVersion)),
  );
  console.log('');

  console.log(chalk.bold('  Versions traversed:'));
  if (traversedVersions.length === 0) {
    console.log(chalk.dim('    (no LTS lines in this range — patch-only or same-line upgrade)'));
  }
  for (const v of traversedVersions) {
    const latestPatch =
      npmInfo.ltsPatchVersions[v.stableLine] ??
      npmInfo.ltsPatchVersions[v.stableLine.split('.')[0]] ??
      null;

    const patchLabel = latestPatch ? chalk.dim(` (latest patch: ${latestPatch})`) : '';
    const dateLabel = v.releaseDate ? chalk.dim(` · released ${formatDate(v.releaseDate)}`) : '';
    console.log(`    ${chalk.green('•')} ${chalk.bold(v.ltsAlias)} — SDK ${v.stableLine}.x, Angular ${v.angularVersion}${dateLabel}${patchLabel}`);
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
    console.log(chalk.dim(`  ${'─'.repeat(62)}`));

    for (const item of items) {
      printChangeItem(item, opts);
    }

    console.log('');
  }

  // ── Reference links ────────────────────────────────────────────────────────
  console.log(chalk.bold('  📚  Reference Links'));
  console.log(chalk.dim(`  ${'─'.repeat(62)}`));
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
  console.log(chalk.dim(`  ${'─'.repeat(62)}`));
  console.log(`  ${chalk.red('●')} BREAKING : ${chalk.bold(breaking)}`);
  console.log(`  ${chalk.yellow('●')} NOTABLE  : ${chalk.bold(notable)}`);
  console.log(`  ${chalk.blue('●')} INFO     : ${chalk.bold(info)}`);
  console.log('');
}

// Visible character width of every severity badge (all padded to the same length).
const BADGE_WIDTH = 10; // ' BREAKING ' / ' NOTABLE  ' / '  INFO    '

function printChangeItem(item: BreakingChange, opts: ReportOptions): void {
  // Clamp to 120 so the output stays readable on very wide terminals.
  const tw = Math.min(process.stdout.columns ?? 100, 120);

  // "  {badge} " = 2 + BADGE_WIDTH + 1 = 13 visible chars before the title.
  const prefixLen           = 2 + BADGE_WIDTH + 1;
  const titleContinueIndent = ' '.repeat(prefixLen);
  const bodyIndent          = '    ';

  const badge      = severityBadge(item.severity);
  const versionTag = item.uiVersion ? chalk.dim(` [${item.uiVersion}]`) : '';

  // ── Title — word-wrapped, continuation lines aligned under first word ───────
  const titleLines = wordWrap(item.title, tw - prefixLen);
  const titleOut = titleLines
    .map((l, i) =>
      i === 0
        ? `  ${badge} ${chalk.bold(l)}`
        : `${titleContinueIndent}${chalk.bold(l)}`,
    )
    .join('\n');

  console.log('');
  console.log(`${titleOut}${versionTag}`);

  // ── Description — normalised bullets, word-wrapped per paragraph ────────
  if (item.description) {
    const paras = normaliseDescription(item.description).split('\n');
    for (const para of paras) {
      if (!para.trim()) continue;
      const isBullet = para.startsWith('• ');
      // Bullet continuation lines indent by 2 extra spaces to sit under the text.
      const contIndent = bodyIndent + (isBullet ? '  ' : '');
      const wrapWidth  = tw - bodyIndent.length - (isBullet ? 2 : 0);
      const lines      = wordWrap(isBullet ? para.slice(2) : para, wrapWidth);
      lines.forEach((l, i) => {
        const prefix = i === 0 ? `${bodyIndent}${isBullet ? '• ' : ''}` : contIndent;
        console.log(chalk.dim(`${prefix}${l}`));
      });
    }
  }

  if (item.actionRequired) {
    console.log(`${bodyIndent}${chalk.bold('Action:')} ${item.actionRequired}`);
  }
  if (opts.showGrepHints && item.grepHints?.length) {
    console.log(
      `${bodyIndent}${chalk.dim('Grep for:')} ${item.grepHints.map((g) => chalk.cyan(g)).join('  ')}`,
    );
  }
  if (item.sourceUrl) {
    console.log(`${bodyIndent}${chalk.dim('→')} ${chalk.underline(item.sourceUrl)}`);
  }
}

/** Split text into lines of at most `maxWidth` chars, breaking on word boundaries. */
function wordWrap(text: string, maxWidth: number): string[] {
  const safe  = Math.max(maxWidth, 20);
  const words = text.trim().replace(/\s+/g, ' ').split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > safe) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Normalise a scraped changelog description for terminal rendering:
 *  - Convert inline ` * text` list markers to `\n• text` (one bullet per line)
 *  - Strip code-fence language tags (``` ts, etc.)
 *  - Collapse surplus inline whitespace
 */
function normaliseDescription(text: string): string {
  return text
    .replace(/```[a-z]*/gi, '')          // strip code-fence lang annotations
    .replace(/(?<=\S)\s+\*\s+/g, '\n• ') // mid-text " * " → newline + bullet
    .replace(/^\*\s+/gm, '• ')           // line-leading "* " → bullet
    .replace(/[ \t]{2,}/g, ' ')          // collapse inline spaces (preserve newlines)
    .trim();
}

function severityBadge(severity: BreakingChange['severity']): string {
  switch (severity) {
    case 'BREAKING':
      return chalk.bgRed.white.bold(' BREAKING ');
    case 'NOTABLE':
      return chalk.bgYellow.black.bold(' NOTABLE  ');
    case 'INFO':
      return chalk.bgBlue.white.bold('  INFO    ');
  }
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

function printJson(opts: ReportOptions): void {
  const output = {
    from: {
      alias: opts.fromVersion.ltsAlias,
      version: opts.fromVersion.version,
      sdkLine: opts.fromVersion.stableLine,
      angularVersion: opts.fromVersion.angularVersion,
    },
    to: {
      alias: opts.toVersion.ltsAlias,
      version: opts.toVersion.version,
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
    `**Upgrade path:** ${versionLabel(fromVersion)} \u2192 ${versionLabel(toVersion)}`,
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
    { key: 'angular',   label: 'Angular Upgrade Requirements' },
    { key: 'websdk-ui', label: 'WebSDK UI Breaking Changes' },
    { key: 'rest-api',  label: 'REST API / @c8y/client Changes' },
    { key: 'security',  label: 'Security Fixes' },
    { key: 'migration', label: 'Migration Steps' },
  ];

  for (const { key, label } of categories) {
    const items = breakingChanges.filter((c) => c.category === key);
    if (items.length === 0) continue;

    lines.push(`## ${label}`);
    lines.push('');

    for (const item of items) {
      lines.push(`### ${severityEmoji(item.severity)} ${item.title}`);
      lines.push('');
      const introLabel = item.uiVersion;
      if (introLabel) lines.push(`**Introduced in:** \`${introLabel}\``);
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

/**
 * Human-readable label for a resolved version.
 * LTS version:     "2025-lts (SDK 1021.22.x, Angular 18)"
 * Non-LTS version: "1021.0.4 (Angular 18)"
 */
function versionLabel(v: InputVersion): string {
  const date = v.releaseDate ? ` · ${formatDate(v.releaseDate)}` : '';
  return v.ltsAlias
    ? `${v.ltsAlias} (SDK ${v.stableLine}.x, Angular ${v.angularVersion}${date})`
    : `${v.version} (Angular ${v.angularVersion}${date})`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
