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
  /** Angular major version for each SDK stable line, derived from peerDependencies */
  angularVersions: Record<string, number>;
}

/**
 * Extract the Angular major version from an npm peerDependency range string.
 *
 * Handles ranges like `^16.2.11`, `>=18.0.0 <19.0.0`, `~20.0.0`, `18.x`, etc.
 * The first integer in the string is always the Angular major.
 *
 * Exported for unit testing.
 */
export function extractAngularMajorFromRange(range: string): number | null {
  const match = range.match(/\d+/);
  if (!match) return null;
  const major = parseInt(match[0], 10);
  return major >= 2 ? major : null; // Angular 2+ only
}

import { NpmDistTagsSchema, NpmPackageManifestSchema } from './schemas.js';

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
    angularVersions: {},
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

    const parsed = NpmPackageManifestSchema.safeParse(await res.json());
    if (!parsed.success) {
      process.stderr.write(
        `\n[warning] npm registry response for ${PRIMARY_PACKAGE} has unexpected shape — ` +
          `version info and Angular detection may be incomplete.\n  ${parsed.error.message}\n`,
      );
      return result;
    }
    const data = parsed.data;

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

    // Scan all released versions for latest patch per line and their Angular peerDep
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

    // Derive Angular major version per stable line from the latest version's peerDependencies
    for (const line of stableLines) {
      const latestPatch = result.ltsPatchVersions[line];
      if (!latestPatch) continue;
      const range = data.versions?.[latestPatch]?.peerDependencies?.['@angular/core'];
      if (!range) continue;
      const major = extractAngularMajorFromRange(range);
      if (major !== null) result.angularVersions[line] = major;
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
    const parsed = NpmDistTagsSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return parsed.data['dist-tags']?.['latest'] ?? null;
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
