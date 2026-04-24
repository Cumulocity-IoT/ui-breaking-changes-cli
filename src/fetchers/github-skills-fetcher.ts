/**
 * Fetches Cumulocity breaking-change data by scraping the live documentation
 * pages directly. No skills repository is involved.
 *
 * Data sources:
 *  - WebSDK changes: https://cumulocity.com/docs/{year}/change-logs/
 *  - REST API changes: https://cumulocity.com/docs/change-logs/
 *
 * The version map is derived from npm dist-tags — see src/npm-fetcher.ts.
 */

import type { BreakingChange, Category, Severity } from '../data/breaking-changes.js';
import type { SdkVersion } from '../version-map.js';
import { fetchC8yChangelog, fetchC8yChangelogGlobal, type C8yChangelogEntry } from './c8y-changelog-fetcher.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CoreSkillsData {
  versions: SdkVersion[];
  changes: BreakingChange[];
}

/**
 * Fetch all breaking changes for the given traversal years from the live
 * Cumulocity documentation pages.
 *
 * Fetched in parallel:
 *  - One request per year for WebSDK changes (announcements + api-changes on the web-sdk component)
 *  - One request for the global REST API changelog (all api-change entries on rest-api component)
 *
 * @param traversedYears  Calendar years to fetch WebSDK changes for (e.g. [2025, 2026])
 * @param versions        Full known version list, used to map dates to LTS aliases
 */
export async function fetchChangelogs(
  traversedYears: number[],
  versions: SdkVersion[],
): Promise<BreakingChange[]> {
  const [webSdkResults, restApiEntries] = await Promise.all([
    Promise.all(
      traversedYears.map((year) =>
        fetchC8yChangelog(year, ['announcement', 'api-change'], ['web-sdk']),
      ),
    ),
    fetchC8yChangelogGlobal(['api-change'], ['rest-api']),
  ]);

  const targetAliasSet = new Set(versions.filter((v) => traversedYears.includes(parseInt(v.yearAlias))).map((v) => v.ltsAlias));

  const changes: BreakingChange[] = [];

  // WebSDK changes — one result array per year
  for (let i = 0; i < traversedYears.length; i++) {
    const year = traversedYears[i];
    const entries = webSdkResults[i];
    for (const entry of entries) {
      const change = convertWebSdkEntry(entry, year, versions);
      if (change) changes.push(change);
    }
  }

  // REST API changes — global page, filtered to traversal range by date
  for (const entry of restApiEntries) {
    const change = convertRestApiEntry(entry, versions);
    if (!change) continue;
    if (!targetAliasSet.has(change.introducedIn)) continue;
    changes.push(change);
  }

  return changes;
}

// ─── Converters ───────────────────────────────────────────────────────────────

function convertWebSdkEntry(
  entry: C8yChangelogEntry,
  year: number,
  versions: SdkVersion[],
): BreakingChange | null {
  if (!entry.title) return null;

  const ltsAlias = yearToLtsAlias(year, versions);
  if (!ltsAlias) return null;

  const severity = classifyWebSdkSeverity(entry);
  const category = classifyWebSdkCategory(entry.title, entry.description);

  return {
    introducedIn: ltsAlias,
    severity,
    category,
    title: entry.title,
    description: entry.description,
    sourceUrl: entry.url,
  };
}

function convertRestApiEntry(
  entry: C8yChangelogEntry,
  versions: SdkVersion[],
): BreakingChange | null {
  if (!entry.title) return null;

  const introducedIn = mapDateToLtsAlias(entry.date, versions);
  if (introducedIn === 'unknown') return null;

  const severity = classifyRestApiSeverity(entry.title, entry.description);

  return {
    introducedIn,
    severity,
    category: 'rest-api',
    title: entry.title,
    description: entry.description,
    sourceUrl: entry.url,
  };
}

// ─── Classification ───────────────────────────────────────────────────────────

function classifyWebSdkSeverity(entry: C8yChangelogEntry): Severity {
  if (entry.changeType === 'api-change') return 'BREAKING';
  if (entry.title.toLowerCase().startsWith('planned:')) return 'INFO';
  return 'NOTABLE';
}

function classifyWebSdkCategory(title: string, body: string): Category {
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

function classifyRestApiSeverity(title: string, body: string): Severity {
  const text = (title + ' ' + body).toLowerCase();
  if (title.toLowerCase().startsWith('planned:')) return 'INFO';
  if (/\bnow includes?\b|\bbecomes case.insensitive\b/.test(text)) return 'NOTABLE';
  return 'BREAKING';
}

// ─── Date / version mapping ───────────────────────────────────────────────────

/**
 * Map a year number to the LTS alias for that year.
 * Finds the version whose yearAlias matches.
 */
function yearToLtsAlias(year: number, versions: SdkVersion[]): string | null {
  return versions.find((v) => parseInt(v.yearAlias) === year)?.ltsAlias ?? null;
}

/**
 * Dynamically maps a date string to an LTS alias using the fetched version list.
 * Finds the most recent LTS version whose release year is <= the date's year.
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
