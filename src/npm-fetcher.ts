/**
 * Fetches version information from the npm registry.
 *
 * Uses the public npm registry API — no auth required.
 */

export interface NpmVersionInfo {
  /** The package name */
  packageName: string;
  /** Version resolved for `latest` tag */
  latest: string | null;
  /** All available dist-tags (e.g. latest, y2025-lts, y2026-lts, next) */
  distTags: Record<string, string>;
  /** Latest version for each LTS line (key = "1021.22", value = "1021.22.145") */
  ltsPatchVersions: Record<string, string>;
}

const NPM_REGISTRY = 'https://registry.npmjs.org';
const PRIMARY_PACKAGE = '@c8y/ngx-components';

/**
 * Fetch npm dist-tags and derive the latest patch version per stable line.
 *
 * Falls back gracefully if the registry is unreachable — returns null values
 * rather than throwing.
 *
 * @param stableLines - SDK stable lines to track, derived from fetched version data.
 */
export async function fetchNpmVersionInfo(stableLines: string[]): Promise<NpmVersionInfo> {
  const result: NpmVersionInfo = {
    packageName: PRIMARY_PACKAGE,
    latest: null,
    distTags: {},
    ltsPatchVersions: {},
  };

  try {
    const url = `${NPM_REGISTRY}/${encodeURIComponent(PRIMARY_PACKAGE)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return result;
    }

    const data = (await res.json()) as {
      'dist-tags': Record<string, string>;
      versions?: Record<string, unknown>;
    };

    result.distTags = data['dist-tags'] ?? {};
    result.latest = result.distTags['latest'] ?? null;

    // Derive latest patch version per known stable line from dist-tags
    for (const [, version] of Object.entries(result.distTags)) {
      for (const line of stableLines) {
        if (version.startsWith(line)) {
          const existing = result.ltsPatchVersions[line];
          if (!existing || compareSemver(version, existing) > 0) {
            result.ltsPatchVersions[line] = version;
          }
        }
      }
    }

    // Also scan all released versions for any stable lines we didn't find via tags
    if (data.versions) {
      for (const version of Object.keys(data.versions)) {
        for (const line of stableLines) {
          if (version.startsWith(line)) {
            const existing = result.ltsPatchVersions[line];
            if (!existing || compareSemver(version, existing) > 0) {
              result.ltsPatchVersions[line] = version;
            }
          }
        }
      }
    }
  } catch {
    // Network unreachable — return empty result
  }

  return result;
}

/**
 * Fetch the latest CD (continuous delivery) release version from npm.
 *
 * Returns the full semver string pinned to the `latest` dist-tag (e.g. "1023.14.5"),
 * or `null` when the registry is unreachable.
 */
export async function fetchLatestCdVersion(): Promise<string | null> {
  try {
    const url = `${NPM_REGISTRY}/${encodeURIComponent(PRIMARY_PACKAGE)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { 'dist-tags'?: Record<string, string> };
    return data['dist-tags']?.['latest'] ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/[^0-9.]/g, '')
      .split('.')
      .map(Number);

  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
