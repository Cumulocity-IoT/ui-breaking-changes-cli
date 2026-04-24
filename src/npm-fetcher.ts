/**
 * Fetches version information from the npm registry.
 *
 * The npm dist-tags on @c8y/ngx-components are the source of truth for the
 * SDK version map. Tags like `y2026-lts` resolve to a full semver from which
 * the stable line and Angular version (via peerDependencies) are derived.
 *
 * Uses the public npm registry API — no auth required.
 */

import type { SdkVersion } from './version-map.js';

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
 * Combined result of a single npm fetch — both the version map and npm patch info.
 */
export interface NpmDerivedData {
  versions: SdkVersion[];
  npmInfo: NpmVersionInfo;
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
 * Fetch the full npm package manifest and derive both the SDK version map
 * (from y????-lts dist-tags) and per-line patch version + Angular info.
 *
 * A single HTTP request replaces both the old skills-repo version map fetch
 * and the separate npm version info fetch.
 *
 * Falls back gracefully if the registry is unreachable.
 */
export async function fetchNpmDerivedData(): Promise<NpmDerivedData> {
  const emptyNpmInfo: NpmVersionInfo = {
    packageName: PRIMARY_PACKAGE,
    latest: null,
    distTags: {},
    ltsPatchVersions: {},
    angularVersions: {},
  };

  let data: ReturnType<typeof NpmPackageManifestSchema.safeParse>['data'] | undefined;

  try {
    const url = `${NPM_REGISTRY}/${encodeURIComponent(PRIMARY_PACKAGE)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { versions: [], npmInfo: emptyNpmInfo };

    const parsed = NpmPackageManifestSchema.safeParse(await res.json());
    if (!parsed.success) {
      process.stderr.write(
        `\n[warning] npm registry response for ${PRIMARY_PACKAGE} has unexpected shape — ` +
          `version map and patch info may be incomplete.\n  ${parsed.error.message}\n`,
      );
      return { versions: [], npmInfo: emptyNpmInfo };
    }
    data = parsed.data;
  } catch {
    return { versions: [], npmInfo: emptyNpmInfo };
  }

  const distTags = data['dist-tags'] ?? {};
  const latest = distTags['latest'] ?? null;

  // ── Build version map from y????-lts dist-tags ─────────────────────────────
  // Tags are like `y2026-lts` → `1023.14.50`. From that version we derive the
  // stable line and Angular version. Future LTS lines (e.g. y2027-lts) are
  // included automatically as soon as the tag exists — nothing is hardcoded.
  const versions: SdkVersion[] = [];

  for (const [tag, version] of Object.entries(distTags)) {
    const match = tag.match(/^y(\d{4})-lts$/);
    if (!match) continue;

    const year = match[1];
    const ltsAlias = `${year}-lts`;
    const stableLine = deriveStableLine(version);
    const angularRange = data.versions?.[version]?.peerDependencies?.['@angular/core'] ?? '';
    const angularVersion = extractAngularMajorFromRange(angularRange) ?? 0;

    versions.push({
      ltsAlias,
      yearAlias: year,
      stableLine,
      primaryVersion: version,
      angularVersion,
      supportStatus: version === latest ? 'Active' : 'LTS',
      changelogUrl: `https://cumulocity.com/docs/${year}/change-logs/?component=.component-web-sdk`,
    });
  }

  versions.sort((a, b) => parseFloat(a.stableLine) - parseFloat(b.stableLine));

  // ── Build NpmVersionInfo for patch version display ─────────────────────────
  const stableLines = versions.map((v) => v.stableLine);
  const npmInfo: NpmVersionInfo = {
    packageName: PRIMARY_PACKAGE,
    latest,
    distTags,
    ltsPatchVersions: {},
    angularVersions: {},
  };

  // Seed from dist-tags
  for (const version of Object.values(distTags)) {
    for (const line of stableLines) {
      if (version.startsWith(line + '.') || version.startsWith(line)) {
        const existing = npmInfo.ltsPatchVersions[line];
        if (!existing || compareSemver(version, existing) > 0) {
          npmInfo.ltsPatchVersions[line] = version;
        }
      }
    }
  }

  // Scan all released versions for better patch data and Angular peerDeps
  if (data.versions) {
    for (const version of Object.keys(data.versions)) {
      for (const line of stableLines) {
        if (version.startsWith(line + '.') || version === line) {
          const existing = npmInfo.ltsPatchVersions[line];
          if (!existing || compareSemver(version, existing) > 0) {
            npmInfo.ltsPatchVersions[line] = version;
          }
        }
      }
    }
  }

  // Derive Angular major version per stable line from peerDependencies
  for (const line of stableLines) {
    const latestPatch = npmInfo.ltsPatchVersions[line];
    if (!latestPatch) continue;
    const range = data.versions?.[latestPatch]?.peerDependencies?.['@angular/core'];
    if (!range) continue;
    const major = extractAngularMajorFromRange(range);
    if (major !== null) npmInfo.angularVersions[line] = major;
  }

  // Sync angular versions back into the version objects from live peerDep data
  for (const v of versions) {
    const live = npmInfo.angularVersions[v.stableLine];
    if (live) v.angularVersion = live;
  }

  return { versions, npmInfo };
}

/**
 * Fetch only the latest CD (continuous delivery) release version from npm.
 *
 * Used when --from or --to is the alias "cd". Returns the `latest` dist-tag
 * version (e.g. "1023.14.5"), or `null` when the registry is unreachable.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a stable line string from a full semver.
 * "1023.14.50" → "1023.14"  (major.minor, when minor != 0)
 * "1018.0.5"   → "1018"     (major only, when minor is 0)
 *
 * Future LTS lines may initially ship as x.0.y until their minor stabilises,
 * so this derivation is always done live from the current dist-tag value.
 */
function deriveStableLine(version: string): string {
  const parts = version.replace(/[^0-9.]/g, '').split('.');
  if (parts.length >= 2 && parts[1] !== '0') {
    return `${parts[0]}.${parts[1]}`;
  }
  return parts[0];
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

