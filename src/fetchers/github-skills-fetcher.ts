/**
 * Fetches and parses Cumulocity SDK skills from the official GitHub skills repository.
 *
 * All breaking change data, version metadata, and migration steps come from here.
 * Nothing is hardcoded in this codebase.
 *
 * Skills repository: https://github.com/Cumulocity-IoT/cumulocity-skills
 */

import type { BreakingChange, Category, MigrationStep, Severity, VersionMigration } from '../data/breaking-changes.js';
import type { SdkVersion } from '../version-map.js';

const BASE_URL =
  'https://raw.githubusercontent.com/Cumulocity-IoT/cumulocity-skills/main/skills';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CoreSkillsData {
  versions: SdkVersion[];
  changes: BreakingChange[];
}

/**
 * Fetch and parse the core skills:
 *  - websdk-version-map  → version metadata
 *  - websdk-breaking-changelog → WebSDK UI / Angular breaking changes
 *  - c8y-client-breaking-changelog → REST API breaking changes
 */
export async function fetchCoreSkillsData(): Promise<CoreSkillsData> {
  const [versionMapMd, websdkChangelogMd, restApiMd] = await Promise.all([
    fetchSkill('websdk-version-map'),
    fetchSkill('websdk-breaking-changelog'),
    fetchSkill('c8y-client-breaking-changelog'),
  ]);

  const versions = parseVersionData(versionMapMd, websdkChangelogMd);
  const websdkChanges = parseWebsdkChangelog(websdkChangelogMd);
  const restApiChanges = parseRestApiChangelog(restApiMd, versions);

  return { versions, changes: [...websdkChanges, ...restApiChanges] };
}

/**
 * Fetch and parse migration step guides for the given LTS aliases.
 * Each LTS version has an associated upgrade skill that is fetched on demand.
 */
export async function fetchMigrationPlans(
  ltsAliases: string[],
  versions: SdkVersion[],
): Promise<VersionMigration[]> {
  const skillNames = ltsAliases
    .map((alias) => versions.find((v) => v.ltsAlias === alias)?.upgradeSkillName)
    .filter((n): n is string => !!n);

  const uniqueSkillNames = [...new Set(skillNames)];

  const mds = await Promise.all(uniqueSkillNames.map((n) => fetchSkill(n, true)));

  const plans: VersionMigration[] = [];
  for (let i = 0; i < uniqueSkillNames.length; i++) {
    const md = mds[i];
    if (!md) continue;
    const plan = parseMigrationPlan(md, uniqueSkillNames[i]);
    if (plan) plans.push(plan);
  }

  // Sort by toLine ascending (oldest migration first)
  plans.sort((a, b) => parseFloat(a.toLine) - parseFloat(b.toLine));
  return plans;
}

// ─── HTTP fetch ───────────────────────────────────────────────────────────────

async function fetchSkill(name: string, optional = false): Promise<string> {
  const url = `${BASE_URL}/${name}/SKILL.md`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'c8y-breaking-changes-cli/1.0', Accept: 'text/plain' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      if (optional) return '';
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
  } catch (err) {
    if (optional) return '';
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch skill "${name}" from GitHub.\n  URL: ${url}\n  Reason: ${msg}\n` +
        `  Check your network connection or use --no-fetch to skip live data.`,
    );
  }
}

// ─── Version data ─────────────────────────────────────────────────────────────

function parseVersionData(versionMapMd: string, websdkChangelogMd: string): SdkVersion[] {
  // From websdk-version-map/SKILL.md:
  //   | Release Year | LTS Alias | Primary Minor Version | Typical Support Range |
  const versionRows = findTable(versionMapMd, 'Release Year');

  // From websdk-breaking-changelog/SKILL.md (its own Version Map table):
  //   | Release Year | LTS Alias | Primary SDK Version | Angular Version |
  const angularRows = findTable(websdkChangelogMd, 'Angular Version');

  // Upgrade skill mapping from websdk-version-map/SKILL.md:
  //   | From Version | To Version | Skill to Use |
  const upgradeRows = findTable(versionMapMd, 'From Version');

  const versions: SdkVersion[] = [];

  for (const row of versionRows) {
    const year = row['Release Year']?.trim();
    const ltsAlias = row['LTS Alias']?.trim();
    const primaryVersion = row['Primary Minor Version']?.trim();
    const supportStatus = row['Typical Support Range']?.trim() ?? '';

    if (!year || !ltsAlias || !primaryVersion) continue;

    // Angular version from the changelog's version table
    const angularRow = angularRows.find((r) => r['LTS Alias']?.trim() === ltsAlias);
    const angularVersion = parseInt(angularRow?.['Angular Version']?.trim() ?? '0', 10);

    // Stable line: "1023.14.0" → "1023.14", "1018.0.0" → "1018"
    const stableLine = deriveStableLine(primaryVersion);

    // Find the upgrade skill for this version (the "to" column matches this version's minor)
    const stablePrefix = stableLine.split('.')[0];
    const upgradeRow = upgradeRows.find((r) =>
      r['To Version']?.trim().replace('.x', '') === stablePrefix,
    );
    const upgradeSkillName =
      (upgradeRow?.['Skill to Use']?.trim() ?? `websdk-${stablePrefix}-upgrade`).replace(/`/g, '');

    versions.push({
      ltsAlias,
      yearAlias: year,
      stableLine,
      primaryVersion,
      angularVersion,
      supportStatus,
      changelogUrl: `https://cumulocity.com/docs/${year}/change-logs/?component=.component-web-sdk`,
      upgradeSkillName,
    });
  }

  return versions.sort((a, b) => parseFloat(a.stableLine) - parseFloat(b.stableLine));
}

function deriveStableLine(version: string): string {
  // "1023.14.0" → "1023.14"
  // "1018.0.0"  → "1018"
  const parts = version.replace(/[^0-9.]/g, '').split('.');
  if (parts.length >= 2 && parts[1] !== '0') {
    return `${parts[0]}.${parts[1]}`;
  }
  return parts[0];
}

// ─── WebSDK breaking changelog ────────────────────────────────────────────────

function parseWebsdkChangelog(md: string): BreakingChange[] {
  const changes: BreakingChange[] = [];
  let currentLtsAlias = '';

  // Split on horizontal rules; year section headers and entries are each in a chunk
  const chunks = md.split(/\n---+\n/);

  for (const chunk of chunks) {
    // Update current LTS alias when we encounter a year section header
    const yearMatch = chunk.match(/^## (\d{4}) Release/m);
    if (yearMatch) {
      currentLtsAlias = `${yearMatch[1]}-lts`;
    }

    // Parse a breaking change entry if this chunk contains one
    const severityMatch = chunk.match(/^### (BREAKING|NOTABLE|INFO)\s+[—–-]+\s*(.+)$/m);
    if (!severityMatch) continue;

    const severity = severityMatch[1].trim() as Severity;
    const titleRaw = severityMatch[2].trim();
    // Title may span to end of the first line only
    const title = titleRaw.split('\n')[0].trim();

    // The body is everything after the ### line
    const headerEnd = chunk.indexOf(severityMatch[0]) + severityMatch[0].length;
    const body = chunk.slice(headerEnd);

    // Override LTS alias if "Introduced in: YYYY" is present in this entry
    const introducedYearMatch = body.match(/\*\*Introduced in:\*\*\s*(\d{4})/);
    const introducedIn = introducedYearMatch
      ? `${introducedYearMatch[1]}-lts`
      : currentLtsAlias;

    if (!introducedIn) continue;

    const description = extractDescription(body);
    const actionRequired = extractActionRequired(body);
    const category = classifyWebsdkCategory(title, body);

    if (!title) continue;

    changes.push({
      introducedIn,
      severity,
      category,
      title,
      description,
      actionRequired,
    });
  }

  return changes;
}

function extractDescription(body: string): string {
  // Description = text between the metadata block and **Action required**
  // Strip metadata lines (**Type:**, **Introduced in:**)
  const metaPattern = /\*\*(Type|Introduced in)[^*]*\*\*[^\n]*/g;
  const stripped = body.replace(metaPattern, '').replace(/^\n+/, '');

  const actionIdx = stripped.search(/\*\*Action required/i);
  const raw = actionIdx >= 0 ? stripped.slice(0, actionIdx) : stripped;
  return cleanText(raw);
}

function extractActionRequired(body: string): string {
  const match = body.match(/\*\*Action required[^:]*:\*\*\s*([\s\S]+?)(?:\n---+\n|\n## \d{4}|$)/i);
  return match ? cleanText(match[1]) : '';
}

function classifyWebsdkCategory(title: string, body: string): Category {
  const text = (title + ' ' + body).toLowerCase();
  if (/security|xss|css injection|vulnerabilit/.test(text)) return 'security';
  if (
    /\bangular \d+\b|\bng update\b|\bstandalone.{1,20}flag\b|\bzoneless\b/.test(text) &&
    /upgrade|angular/i.test(title)
  ) {
    return 'angular';
  }
  return 'websdk-ui';
}

// ─── REST API changelog ───────────────────────────────────────────────────────

function parseRestApiChangelog(md: string, versions: SdkVersion[]): BreakingChange[] {
  const changes: BreakingChange[] = [];

  const chunks = md.split(/\n---+\n/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('###')) continue;

    const headerMatch = trimmed.match(/^###\s+(.+)$/m);
    if (!headerMatch) continue;

    const title = headerMatch[1].trim();

    const dateMatch = trimmed.match(/\*\*Date:\*\*\s*([^\n]+)/);
    const dateStr = dateMatch?.[1]?.trim() ?? '';
    const introducedIn = mapDateToLtsAlias(dateStr, versions);
    if (introducedIn === 'unknown') continue;

    const body = trimmed.slice(trimmed.indexOf(headerMatch[0]) + headerMatch[0].length);

    // Description: between date line and "Affected client methods" or "Action required"
    const afterDate = body.slice((body.match(/\*\*Date:\*\*/)?.[0]?.length ?? 0));
    const descEnd = afterDate.search(/\*\*(Affected client methods|Action required):/i);
    const description = cleanText(descEnd >= 0 ? afterDate.slice(0, descEnd) : afterDate);

    const actionMatch = body.match(/\*\*Action required[^:]*:\*\*\s*([\s\S]+?)$/i);
    const actionRequired = cleanText(actionMatch?.[1] ?? '');
    if (!actionRequired) continue;

    const severity: Severity = classifyRestApiSeverity(title, body);

    changes.push({
      introducedIn,
      severity,
      category: 'rest-api',
      title,
      description,
      actionRequired,
    });
  }

  return changes;
}

function classifyRestApiSeverity(title: string, body: string): Severity {
  const text = (title + ' ' + body).toLowerCase();
  if (title.toLowerCase().startsWith('planned:')) return 'INFO';
  // Behavioral changes that add/include more data → NOTABLE
  if (/\bnow includes?\b|\bbecomes case.insensitive\b/.test(text)) return 'NOTABLE';
  return 'BREAKING';
}

/**
 * Dynamically maps a date string to an LTS alias using the fetched version list.
 * Finds the most recent LTS version whose release year is ≤ the date's year.
 * No years are hardcoded — works automatically as new LTS versions are added.
 */
function mapDateToLtsAlias(dateStr: string, versions: SdkVersion[]): string {
  const yearMatch = dateStr.match(/\b(\d{4})\b/);
  if (!yearMatch) return 'unknown';
  const year = parseInt(yearMatch[1], 10);
  const sorted = [...versions].sort((a, b) => parseInt(a.yearAlias) - parseInt(b.yearAlias));
  const match = sorted.filter((v) => parseInt(v.yearAlias, 10) <= year).pop();
  return match?.ltsAlias ?? 'unknown';
}

// ─── Upgrade skill / migration plan ──────────────────────────────────────────

function parseMigrationPlan(md: string, skillName: string): VersionMigration | null {
  // Extract from/to from the skill's title: "Migrate from Web SDK 1020 to Web SDK 1021".
  // If the title is absent the skill cannot be reliably attributed to a version pair — skip it.
  const titleMatch = md.match(/Migrate from Web SDK (\S+) to Web SDK (\S+)/i);
  if (!titleMatch) return null;

  const fromLine = `${titleMatch[1]}.x`;
  const toLine = `${titleMatch[2]}.x`;

  const steps = parseMigrationSteps(md);
  if (steps.length === 0) return null;

  return {
    fromLine,
    toLine,
    steps,
    referenceUrl: `${BASE_URL}/${skillName}/SKILL.md`,
  };
}

function parseMigrationSteps(md: string): MigrationStep[] {
  const steps: MigrationStep[] = [];

  // Match "## Step N – Title" (em dash, en dash, or hyphen)
  const stepRe = /^## Step (\d+)\s+[–—-]+\s+(.+)$/mg;
  let match: RegExpExecArray | null;
  const stepStarts: Array<{ index: number; order: number; title: string }> = [];

  while ((match = stepRe.exec(md)) !== null) {
    stepStarts.push({ index: match.index, order: parseInt(match[1], 10), title: match[2].trim() });
  }

  for (let i = 0; i < stepStarts.length; i++) {
    const { order, title, index } = stepStarts[i];
    const nextIdx = stepStarts[i + 1]?.index ?? md.length;
    const content = md.slice(index, nextIdx);

    // Extract bash/sh commands from code blocks
    const commands: string[] = [];
    const codeRe = /```(?:bash|sh)\n([\s\S]+?)\n```/g;
    let codeMatch: RegExpExecArray | null;
    while ((codeMatch = codeRe.exec(content)) !== null) {
      const lines = codeMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
      commands.push(...lines);
    }

    // Extract description: text immediately after the step header, before first code/sub-section
    const headerLineEnd = content.indexOf('\n') + 1;
    const body = content.slice(headerLineEnd);
    const descEnd = Math.min(
      body.search(/```/) >= 0 ? body.search(/```/) : Infinity,
      body.search(/^### /m) >= 0 ? body.search(/^### /m) : Infinity,
      body.search(/^## Step /m) >= 0 ? body.search(/^## Step /m) : Infinity,
      body.length,
    );
    const description = cleanText(body.slice(0, descEnd)) || undefined;

    steps.push({
      order,
      title,
      description,
      commands: commands.length > 0 ? commands : undefined,
    });
  }

  return steps.sort((a, b) => a.order - b.order);
}

// ─── Markdown table parser ────────────────────────────────────────────────────

/**
 * Finds the first markdown table whose header row contains a cell matching
 * `firstColumnHeader` (case-insensitive), and returns its rows as objects.
 */
function findTable(md: string, firstColumnHeader: string): Record<string, string>[] {
  const lines = md.split('\n');
  const results: Record<string, string>[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line.startsWith('|')) {
      i++;
      continue;
    }

    const cells = splitTableRow(line);

    // Is this the header row we're looking for?
    if (cells.some((c) => c.toLowerCase().includes(firstColumnHeader.toLowerCase()))) {
      const headers = cells;
      i++;

      // Skip separator row (|---|---|)
      if (i < lines.length && /^\|[\s\-|:]+\|$/.test(lines[i].trim())) {
        i++;
      }

      // Collect data rows
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const rowCells = splitTableRow(lines[i].trim());
        // Skip separator-like rows
        if (!rowCells.every((c) => /^[-:\s]*$/.test(c))) {
          const row: Record<string, string> = {};
          headers.forEach((h, j) => {
            row[h] = rowCells[j] ?? '';
          });
          results.push(row);
        }
        i++;
      }

      break;
    }

    i++;
  }

  return results;
}

function splitTableRow(line: string): string[] {
  return line.split('|').slice(1, -1).map((c) => c.trim());
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function cleanText(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')        // **bold** → text
    .replace(/`([^`\n]+)`/g, '$1')               // `code` → text
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, '$1') // [link](url) → link text
    .replace(/^>\s*/gm, '')                       // blockquotes
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
