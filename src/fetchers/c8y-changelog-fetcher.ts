/**
 * Fetches and parses the Cumulocity documentation changelog pages.
 *
 * The pages are server-side rendered by Hugo so the full content is available
 * in the raw HTML without JavaScript execution.  Each change is contained in a
 * `<section class="page-section change-type-X component-Y ..." data-date="...">`.
 *
 * Parsed entries are validated with `C8yChangelogEntrySchema` before being
 * returned so structural regressions in the page HTML surface as warnings
 * rather than silently producing bad data.
 */

import { C8yChangelogEntrySchema, ChangelogHtmlSchema, type C8yChangelogEntry } from '../schemas.js';
import type { BreakingChange, Category, Severity } from '../data/breaking-changes.js';
import type { InputVersion, SdkVersion } from '../version-map.js';
import { compareSemver } from '../utils.js';
export type { C8yChangelogEntry };

const BASE_DOCS_URL = 'https://cumulocity.com/docs';

/**
 * Fetch the Cumulocity changelog page for a given release year and return all
 * matching entries for the specified change types and components.
 *
 * @param year        Release year, e.g. `2025` or `2026`.
 * @param changeTypes Change-type slugs to include, e.g. `['api-change', 'announcement']`.
 * @param components  Component slugs to include, e.g. `['rest-api', 'web-sdk']`.
 */
export async function fetchC8yChangelog(
  year: number,
  changeTypes: string[],
  components: string[],
): Promise<C8yChangelogEntry[]> {
  const url = `${BASE_DOCS_URL}/${year}/change-logs/`;
  return fetchChangelogUrl(url, changeTypes, components);
}

/**
 * Fetch the global (non-year-scoped) Cumulocity changelog page.
 * Used for REST API changes which appear at `cumulocity.com/docs/change-logs/`
 * rather than a year-specific sub-path.
 *
 * @param changeTypes Change-type slugs to include, e.g. `['api-change']`.
 * @param components  Component slugs to include, e.g. `['rest-api']`.
 */
export async function fetchC8yChangelogGlobal(
  changeTypes: string[],
  components: string[],
): Promise<C8yChangelogEntry[]> {
  const url = `${BASE_DOCS_URL}/change-logs/`;
  return fetchChangelogUrl(url, changeTypes, components);
}

async function fetchChangelogUrl(
  url: string,
  changeTypes: string[],
  components: string[],
): Promise<C8yChangelogEntry[]> {

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'c8y-breaking-changes-cli/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const validation = ChangelogHtmlSchema.safeParse(html);
  if (!validation.success) {
    process.stderr.write(
      `\n[warning] Changelog page at ${url} failed structural validation — skipping.\n` +
        `  ${validation.error.issues.map((e) => e.message).join('\\n  ')}\\n`,
    );
    return [];
  }

  return parseChangelogHtml(html, url, changeTypes, components);
}

/**
 * Parse raw HTML from a Cumulocity changelog page.
 * Exported so tests can drive it with fixture HTML without network calls.
 *
 * Each change entry is a `<section class="page-section change-type-X component-Y ..."
 * data-date="...">` block.  The parser extracts:
 *
 *  - `id`          — section anchor
 *  - `date`        — from data-date attribute; falls back to the most recently
 *                    seen `<h5>` date header when data-date is absent (used on
 *                    the global /docs/change-logs/ page which groups entries
 *                    under `<h5>Month DD, YYYY</h5>` headers)
 *  - `changeType`  — first `change-type-X` class, X returned (e.g. "api-change")
 *  - `component`   — first `component-X` class in the section, X returned (e.g. "rest-api")
 *  - `title`       — text content of `<h2>` (stripped of the copy-link button HTML)
 *  - `description` — all `<p>` content between `</div>` (end of summary div) and
 *                    `<div class="change-log__details">`, stripped of HTML tags
 *  - `url`         — page URL + `#id`
 */
export function parseChangelogHtml(
  html: string,
  pageUrl: string,
  changeTypes: string[],
  components: string[],
): C8yChangelogEntry[] {
  const results: C8yChangelogEntry[] = [];
  // Normalise: always end with / so that `#fragment` appended gives `path/#fragment`
  const baseUrl = pageUrl.replace(/\/?$/, '/');

  // Split on literal '<section' to avoid catastrophic backtracking on large HTML.
  // Each chunk after the split either starts with the rest of a <section ...> tag
  // (attributes + body) or is irrelevant preamble before the first section.
  const chunks = html.split('<section');

  // Track the most recently seen <h5> date header.  On the global changelog page
  // entries may lack a data-date attribute and instead rely on the preceding
  // <h5>Month DD, YYYY</h5> to indicate when they were published.
  let lastH5Date = '';

  for (const chunk of chunks) {
    // Find the closing > of the opening tag (attributes may span multiple lines,
    // but none contain a bare > so indexOf is safe here).
    const tagEnd = chunk.indexOf('>');
    if (tagEnd === -1) continue;

    const openTag = chunk.slice(0, tagEnd);
    const body    = chunk.slice(tagEnd + 1);

    // Scan the body for any <h5> date header — it will apply to subsequent sections
    const h5Match = body.match(/<h5[^>]*>([^<]+)<\/h5>/);
    if (h5Match) {
      const parsed = new Date(h5Match[1].trim());
      if (!Number.isNaN(parsed.getTime())) lastH5Date = parsed.toISOString();
    }

    // Only process change-log sections
    if (!openTag.includes('page-section')) continue;

    // Extract class string (double-quoted attribute value)
    const classMatch = openTag.match(/class="([^"]*)"/);
    if (!classMatch) continue;
    const classes = classMatch[1];

    const changeType = extractFirstClassTag(classes, 'change-type-');
    if (!changeType || !changeTypes.includes(changeType)) continue;

    const component = extractFirstClassTag(classes, 'component-');
    if (!component || !components.includes(component)) continue;

    // id attribute (single-quoted in this Hugo template)
    const idMatch = openTag.match(/id='([^']+)'/);
    const id = idMatch?.[1] ?? '';

    // data-date attribute; fall back to the last h5 date header when absent
    const dateMatch = openTag.match(/data-date="([^"]+)"/);
    const date = dateMatch ? dateMatch[1].replace(/&#43;/g, '+') : lastH5Date;

    // Title: text inside <h2> before the copy-link <button>
    const h2Match = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const rawH2 = h2Match ? h2Match[1].replace(/<button[\s\S]*?<\/button>/g, '') : '';
    const title = stripHtml(rawH2);

    // Description: <p> tag(s) between the closing </div> of change-log__summary
    // and the opening of <div class="change-log__details">
    const descMatch = body.match(
      /<\/div>\s*(<p[\s\S]*?)\s*<div[^>]*class="[^"]*change-log__details/,
    );
    const description = descMatch ? stripHtml(descMatch[1]) : '';

    // Optional: version string from the `data-tag="technicalcomponent-ui-c8y"` metadata button.
    // Present on Web SDK entries; the <p> inside the button contains text like
    // "ui-c8y\n - 1023.0.0".  Extract the first semver (major.minor or major.minor.patch)
    // found anywhere in the <p> content.
    const uiVersionButtonMatch = body.match(
      /data-tag="technicalcomponent-ui-c8y"[\s\S]*?<p>[^<]*?(\d+\.\d+(?:\.\d+)*)\s*<\/p>/,
    );
    const uiVersion = uiVersionButtonMatch?.[1];

    const candidate = {
      id,
      date,
      changeType,
      component,
      title,
      description,
      url: `${baseUrl}#${id}`,
      ...(uiVersion ? { uiVersion } : {}),
    };

    const parsed = C8yChangelogEntrySchema.safeParse(candidate);
    if (parsed.success) {
      results.push(parsed.data);
    } else {
      process.stderr.write(
        `\n[warning] Skipping malformed changelog entry (id="${id}") from ${pageUrl}` +
          ` — page structure may have changed.\n  ${parsed.error.message}\n`,
      );
    }
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the first class suffix after a given prefix.
 * e.g. `extractFirstClassTag("page-section change-type-api-change component-rest-api", "change-type-")`
 * → `"api-change"`
 */
function extractFirstClassTag(classes: string, prefix: string): string | null {
  const re = new RegExp(`(?:^|\\s)${prefix}([\\w-]+)`);
  return classes.match(re)?.[1] ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')     // strip all tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#43;/g, '+')
    .replace(/\s+/g, ' ')         // collapse whitespace
    .trim();
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Fetch all breaking changes from the live Cumulocity documentation page.
 *
 * Both WebSDK and REST API changes come from the single global changelog page
 * (`docs/change-logs/`). Sections are filtered by component CSS class:
 * `component-web-sdk` for WebSDK entries, `component-rest-api` for REST API.
 * Date-based filtering (entry.date vs fromVersion/toVersion release dates)
 * determines which changes fall within the requested upgrade range.
 *
 * @param fromVersion  The version being upgraded FROM (used for date boundary filtering)
 * @param toVersion    The version being upgraded TO (used for date boundary filtering)
 * @param versions     Full known version list, used to map entry dates to LTS aliases
 */
export async function fetchChangelogs(
  fromVersion: InputVersion,
  toVersion: InputVersion,
  versions: SdkVersion[],
): Promise<BreakingChange[]> {
  const [webSdkEntries, restApiEntries] = await Promise.all([
    fetchC8yChangelogGlobal(['announcement', 'api-change'], ['web-sdk']),
    fetchC8yChangelogGlobal(['api-change'], ['rest-api']),
  ]);

  // Pre-sort once so dateToLtsAlias doesn't repeat the sort for every entry.
  const sortedVersions = versions.concat()
    .filter((v) => v.releaseDate)
    .sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());

  const changes: BreakingChange[] = [];

  for (const entry of webSdkEntries) {
    const change = convertEntry(entry, fromVersion, toVersion, sortedVersions, classifyWebSdkSeverity, classifyWebSdkCategory);
    if (change) changes.push(change);
  }

  for (const entry of restApiEntries) {
    const change = convertEntry(entry, fromVersion, toVersion, sortedVersions, classifyRestApiSeverity, () => 'rest-api');
    if (change) {
      const { introducedIn: _unused, ...rest } = change;
      changes.push(rest);
    }
  }

  return changes;
}

// ─── Converters ───────────────────────────────────────────────────────────────

function convertEntry(
  entry: C8yChangelogEntry,
  fromVersion: InputVersion,
  toVersion: InputVersion,
  versions: SdkVersion[],
  classifySeverity: (entry: C8yChangelogEntry) => Severity,
  classifyCategory: (title: string, body: string) => Category,
): BreakingChange | null {
  if (!entry.title) return null;

  if (!isInDateRange(entry.date, fromVersion, toVersion)) return null;

  // When a uiVersion is present, apply an additional semver range check.
  if (entry.uiVersion) {
    const [uiMaj, uiMin = 0, uiPatch = 0] = entry.uiVersion.split('.').map(Number);
    const isMajorOnly = uiMin === 0 && uiPatch === 0;

    if (isMajorOnly) {
      // A major-only version (e.g. "1023.0.0") means the change is valid for all
      // patches of that major series.  Just compare the major segment inclusively:
      // include the entry when uiMajor falls anywhere in [fromMajor, toMajor].
      const fromMajor = Number(fromVersion.version.split('.')[0]);
      const toMajor   = Number(toVersion.version.split('.')[0]);
      if (uiMaj < fromMajor || uiMaj > toMajor) return null;
    } else {
      // Exact version: include only when strictly after fromVersion and at most toVersion
      // (mirrors the date filter semantics: strictly after from, on or before to).
      if (
        compareSemver(entry.uiVersion, fromVersion.version) <= 0 ||
        compareSemver(entry.uiVersion, toVersion.version) > 0
      ) {
        return null;
      }
    }
  }

  const introducedIn = dateToLtsAlias(entry.date, versions);
  if (!introducedIn) return null;

  return {
    introducedIn,
    severity: classifySeverity(entry),
    category: classifyCategory(entry.title, entry.description),
    title: entry.title,
    description: entry.description,
    sourceUrl: entry.url,
    ...(entry.uiVersion ? { uiVersion: entry.uiVersion } : {}),
  };
}

// ─── Classification ───────────────────────────────────────────────────────────

function classifyWebSdkSeverity(entry: C8yChangelogEntry): Severity {
  if (entry.changeType === 'api-change') return 'BREAKING';
  if (entry.title.toLowerCase().startsWith('planned:')) return 'INFO';
  return 'NOTABLE';
}

function classifyWebSdkCategory(title: string, body: string): Category {
  const text = (`${title} ${body}`).toLowerCase();
  if (/security|vulnerabilit|exploit|inject|attack|threat|breach|exposure|privilege|authori|authenticat|sanitiz|encrypt|malicious/.test(text)) return 'security';
  if (/\bangular \d+\b|\bng update\b|\bstandalone.{1,20}flag\b|\bzoneless\b/.test(text)) {
    return 'angular';
  }
  return 'websdk-ui';
}

function classifyRestApiSeverity(entry: C8yChangelogEntry): Severity {
  const text = (`${entry.title} ${entry.description}`).toLowerCase();
  if (entry.title.toLowerCase().startsWith('planned:')) return 'INFO';
  if (/\bnow includes?\b|\bbecomes case.insensitive\b/.test(text)) return 'NOTABLE';
  return 'BREAKING';
}

// ─── Date / version mapping ───────────────────────────────────────────────────

/**
 * Map an entry's publish date to the LTS version that first incorporates it.
 *
 * An entry published on date D belongs to the LTS whose npm release date is the
 * SMALLEST value that is still ≥ D.  In other words: the first LTS that shipped
 * AFTER the entry was published, so that upgrading to it exposes the change.
 *
 * @param sortedVersions Versions pre-sorted by releaseDate ascending, with
 *   empty-releaseDate entries already filtered out. Callers must sort once and
 *   reuse — this function does not sort internally.
 */
function dateToLtsAlias(entryDate: string, sortedVersions: SdkVersion[]): string | null {
  const d = new Date(entryDate).getTime();
  if (Number.isNaN(d)) return null;
  return sortedVersions.find((v) => new Date(v.releaseDate).getTime() >= d)?.ltsAlias ?? null;
}

/**
 * Returns true when the entry's date falls strictly after `fromVersion.releaseDate`
 * and on or before `toVersion.releaseDate`.
 *
 * When either releaseDate is absent (npm unavailable), the filter cannot be applied
 * and false is returned (the entry is excluded rather than mis-attributed).
 */
function isInDateRange(
  entryDate: string,
  fromVersion: InputVersion,
  toVersion: InputVersion,
): boolean {
  if (!fromVersion.releaseDate || !toVersion.releaseDate) return false;
  const d    = new Date(entryDate).getTime();
  const from = new Date(fromVersion.releaseDate).getTime();
  const to   = new Date(toVersion.releaseDate).getTime();
  return !Number.isNaN(d) && d > from && d <= to;
}


