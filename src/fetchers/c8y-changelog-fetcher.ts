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

import { C8yChangelogEntrySchema, type C8yChangelogEntry } from '../schemas.js';
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
 *  - `date`        — from data-date attribute
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

  for (const chunk of chunks) {
    // Find the closing > of the opening tag (attributes may span multiple lines,
    // but none contain a bare > so indexOf is safe here).
    const tagEnd = chunk.indexOf('>');
    if (tagEnd === -1) continue;

    const openTag = chunk.slice(0, tagEnd);
    const body    = chunk.slice(tagEnd + 1);

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

    // data-date attribute
    const dateMatch = openTag.match(/data-date="([^"]+)"/);
    const date = dateMatch ? dateMatch[1].replace(/&#43;/g, '+') : '';

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

    const candidate = {
      id,
      date,
      changeType,
      component,
      title,
      description,
      url: `${baseUrl}#${id}`,
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
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#43;/g, '+').trim();
}
