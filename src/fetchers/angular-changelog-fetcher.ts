/**
 * Fetches breaking changes directly from Angular GitHub releases.
 *
 * Used to supplement the Cumulocity skills data with first-party Angular release notes.
 * For a traversal that crosses Angular major versions, every intermediate major
 * (from-exclusive, to-inclusive) is fetched from:
 *   https://api.github.com/repos/angular/angular/releases/tags/{major}.0.0
 *
 * Network failures are graceful — missing releases return an empty array.
 */

import type { BreakingChange } from '../data/breaking-changes.ts';
import { GitHubReleaseSchema } from '../schemas.ts';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/angular/angular/releases/tags';

/**
 * Fetch breaking changes from Angular GitHub release notes for all Angular major versions
 * between fromMajor (exclusive) and toMajor (inclusive).
 *
 * @param fromMajor    Angular major version of the --from SDK line
 * @param toMajor      Angular major version of the --to SDK line
 * @param introducedIn LTS alias to attribute the returned changes to (e.g. "2026-lts")
 */
export async function fetchAngularBreakingChanges(
  fromMajor: number,
  toMajor: number,
  introducedIn: string,
): Promise<BreakingChange[]> {
  if (fromMajor >= toMajor) return [];

  // Fetch every major version in the gap in parallel
  const majors: number[] = [];
  for (let v = fromMajor + 1; v <= toMajor; v++) majors.push(v);

  const bodies = await Promise.all(majors.map(fetchAngularRelease));

  return majors.reduce<BreakingChange[]>((results, major, i) => {
    const body = bodies[i];
    if (!body) return results;
    return results.concat(parseAngularReleaseBody(body, major, introducedIn));
  }, []);
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function fetchAngularRelease(major: number): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_RELEASES_API}/${major}.0.0`, {
      headers: {
        'User-Agent': 'c8y-breaking-changes-cli/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const parsed = GitHubReleaseSchema.safeParse(await res.json());
    if (!parsed.success) {
      process.stderr.write(
        `\n[warning] Angular ${major}.0.0 GitHub release response has unexpected shape — ` +
          `Angular changelog may be incomplete.\n  ${parsed.error.message}\n`,
      );
      return null;
    }
    return parsed.data.body ?? null;
  } catch {
    return null;
  }
}

// ─── Parser (exported for unit testing) ───────────────────────────────────────

/**
 * Parse the markdown body of an Angular GitHub release and return all
 * breaking changes found in the `## Breaking Changes` section.
 *
 * Exported so tests can drive it with fixture data without network calls.
 */
export function parseAngularReleaseBody(
  body: string,
  angularMajor: number,
  introducedIn: string,
): BreakingChange[] {
  const text = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Find the "## Breaking Changes" section header
  const headerMatch = text.match(/^## Breaking Changes\n/m);
  if (!headerMatch || headerMatch.index === undefined) return [];

  const sectionStart = headerMatch.index + headerMatch[0].length;
  const rest = text.slice(sectionStart);

  // Section ends at the next top-level "## " heading (that isn't "Breaking Changes"),
  // or at EOF when "## Breaking Changes" is the last section (Angular 20+ style).
  const nextSectionMatch = rest.match(/^## (?!Breaking)/m);
  const section = nextSectionMatch?.index !== undefined
    ? rest.slice(0, nextSectionMatch.index)
    : rest;
  const changes: BreakingChange[] = [];
  const sourceUrl = `https://github.com/angular/angular/releases/tag/${angularMajor}.0.0`;

  // Split on package subsection headers (### pkg)
  const pkgSections = section.split(/^### /m).slice(1);

  for (const pkgSection of pkgSections) {
    const newline = pkgSection.indexOf('\n');
    if (newline === -1) continue;

    const pkg = pkgSection.slice(0, newline).trim();
    const pkgBody = pkgSection.slice(newline + 1);

    // Skip feature-table sections (start with "| Commit |")
    if (/^\|/.test(pkgBody.trimStart())) continue;

    const bullets = collectBullets(pkgBody);
    for (const bullet of bullets) {
      if (bullet.length < 10) continue;

      // Title: first sentence (up to first `.`/`!`/`?` not inside backticks) or first 100 chars
      const titleEnd = bullet.search(/(?<=[^`])[.!?](?:\s|$)/);
      const rawTitle = titleEnd > 5 && titleEnd < 120
        ? bullet.slice(0, titleEnd + 1)
        : bullet.slice(0, 100) + (bullet.length > 100 ? '…' : '');

      changes.push({
        introducedIn,
        severity: 'BREAKING',
        category: 'angular',
        title: `Angular ${angularMajor} (@angular/${pkg}): ${rawTitle}`,
        description: bullet,
        actionRequired: '',
        sourceUrl,
      });
    }
  }

  return changes;
}

/**
 * Collect top-level bullet items (lines starting with "- ").
 * Continuation lines (indented with spaces or blank lines) are appended to the current item.
 */
function collectBullets(text: string): string[] {
  const lines = text.split('\n');
  const bullets: string[] = [];
  let current = '';

  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (current.trim()) bullets.push(normalise(current));
      current = line.slice(2);
    } else if (current && (line.startsWith('  ') || line.startsWith('\t') || line === '')) {
      current += ` ${line.trim()}`;
    } else {
      // Non-indented, non-bullet line ends the current item
      if (current.trim()) bullets.push(normalise(current));
      current = '';
    }
  }
  if (current.trim()) bullets.push(normalise(current));
  return bullets;
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
