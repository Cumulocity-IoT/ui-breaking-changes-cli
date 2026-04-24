/**
 * Fetches live data from Cumulocity and Angular changelog/migration pages.
 *
 * Because most of these pages render server-side with JavaScript, we can't
 * always parse the full content via a plain HTTP fetch.  We do a best-effort
 * fetch and extract any changelog items we find; otherwise we fall back to
 * the curated static data.
 */

export interface LiveChangelogItem {
  date?: string;
  title: string;
  type: string;
  component: string;
  description: string;
  url: string;
}

/**
 * Attempt to fetch the Cumulocity REST API change-log page and extract
 * visible change items from the HTML.
 *
 * The page is server-side rendered so we can grep the raw HTML for
 * change-log card content.
 */
export async function fetchC8yChangelogPage(url: string): Promise<LiveChangelogItem[]> {
  const items: LiveChangelogItem[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'c8y-breaking-changes-cli/1.0',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return items;

    const html = await res.text();
    // Extract basic change-log title/description from the page HTML.
    // The page uses structured data attributes that are set during SSR.
    const titleMatches = html.matchAll(
      /<h[34][^>]*class="[^"]*change[^"]*"[^>]*>(.*?)<\/h[34]>/gis,
    );
    for (const m of titleMatches) {
      items.push({
        title: stripHtml(m[1]),
        type: 'API CHANGE',
        component: 'rest-api',
        description: '',
        url,
      });
    }
  } catch {
    // Ignore — return empty
  }

  return items;
}

/**
 * Fetch the Cumulocity WebSDK migration overview page and extract
 * the version-specific migration notes visible in the HTML.
 */
export async function fetchMigrationGuide(fromMinor: number, toMinor: number): Promise<string[]> {
  const notes: string[] = [];

  const url = 'https://cumulocity.com/codex/migration-guides/updating-web-sdk-version/overview';

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'c8y-breaking-changes-cli/1.0',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return notes;

    const html = await res.text();

    // The page is dynamic and migration content is loaded client-side
    // based on the selected from/to version.  Extract any static text
    // relevant to the target version range.
    const breakingSection = extractSection(
      html,
      `Migration from Web SDK ${fromMinor} to Web SDK ${toMinor}`,
    );

    if (breakingSection) {
      notes.push(breakingSection);
    }
  } catch {
    // Ignore
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractSection(html: string, heading: string): string | null {
  const idx = html.indexOf(heading);
  if (idx === -1) return null;
  const slice = html.slice(idx, idx + 2000);
  return stripHtml(slice);
}
