/**
 * Fetches version information from the npm registry.
 *
 * The npm dist-tags on @c8y/ngx-components are the source of truth for the
 * SDK version map. Tags like `y2026-lts` resolve to a full semver from which
 * the stable line and Angular version (via peerDependencies) are derived.
 *
 * Uses the public npm registry API — no auth required.
 */

import type { SdkVersion, InputVersion } from './version-map.ts';
import { resolveVersion } from './version-map.ts';
import { compareSemver, isVersionSegmentPrefix } from './utils.ts';

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
  /** The raw validated npm manifest, used for arbitrary version resolution. Null on fetch failure. */
  manifest: import('./schemas.js').NpmPackageManifest | null;
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

import { NpmPackageManifestSchema } from './schemas.ts';

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
    if (!res.ok) return { versions: [], npmInfo: emptyNpmInfo, manifest: null };

    const parsed = NpmPackageManifestSchema.safeParse(await res.json());
    if (!parsed.success) {
      process.stderr.write(
        `\n[warning] npm registry response for ${PRIMARY_PACKAGE} has unexpected shape — ` +
          `version map and patch info may be incomplete.\n  ${parsed.error.message}\n`,
      );
      return { versions: [], npmInfo: emptyNpmInfo, manifest: null };
    }
    data = parsed.data;
  } catch {
    return { versions: [], npmInfo: emptyNpmInfo, manifest: null };
  }

  const distTags = data['dist-tags'] ?? {};
  const latest = distTags.latest ?? null;

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
      releaseDate: '',  // populated below once all versions are collected
    });
  }

  versions.sort((a, b) => parseFloat(a.stableLine) - parseFloat(b.stableLine));

  // ── Populate releaseDate from npm time map ─────────────────────────────────
  // `data.time` maps every version string to an ISO 8601 publish timestamp.
  // The "release date" for an LTS line is when the FIRST version of that line
  // (i.e. stableLine + ".0") was published.  If that exact version is absent,
  // fall back to the earliest timestamp among all versions in the stable line.
  const timeMap = data.time ?? {};
  for (const v of versions) {
    const firstPatch = `${v.stableLine}.0`;
    if (timeMap[firstPatch]) {
      v.releaseDate = timeMap[firstPatch];
    } else {
      // Find the earliest published version matching this stable line
      const entry = Object.entries(timeMap)
        .filter(([ver]) => /^\d/.test(ver) && ver.startsWith(`${v.stableLine}.`))
        .sort(([, a], [, b]) => a.localeCompare(b))  // ISO dates sort lexicographically
        [0];
      v.releaseDate = entry?.[1] ?? '';
    }
  }

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
      if (version.startsWith(`${line}.`) || version.startsWith(line)) {
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
        if (version.startsWith(`${line}.`) || version === line) {
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

  return { versions, npmInfo, manifest: data };
}



/**
 * Resolve any version alias or exact npm version string to an `InputVersion`
 * with a release date and Angular version populated from the npm manifest.
 *
 * Resolution order:
 *  1. `@oldest` / `@latest` suffix — explicit range selector.
 *       `1021@oldest`    → earliest published patch in 1021.x.x
 *       `1021@latest`    → latest  published patch in 1021.x.x
 *       `1021.22@latest` → latest  published patch in 1021.22.x
 *       The prefix may be any number of dot-separated segments.
 *  2. LTS alias / year alias / exact stable-line match via `resolveVersion`.
 *       Returns `lts.primaryVersion` (the dist-tag value) with `lts.releaseDate`
 *       (the date the stable line first appeared on npm, used for range filtering).
 *  3. Full semver `X.Y.Z` only — exact match in the npm `time` map, or the
 *       closest version in the same `X.Y.*` range when the exact patch was
 *       never published (e.g. `1021.0.0` → `1021.0.4`).
 *
 * Partial inputs that are NOT LTS aliases and NOT full semvers (`1021`, `1021.41`)
 * return `undefined`. Use the `@oldest` / `@latest` syntax instead.
 */
export function resolveArbitraryVersion(
  alias: string,
  versions: SdkVersion[],
  manifest: import('./schemas.js').NpmPackageManifest | null,
): InputVersion | undefined {
  // ── Step 1: @oldest / @latest ──────────────────────────────────────────────
  // Explicit range selector: <prefix>@oldest or <prefix>@latest.
  // The prefix is matched as a version-string prefix (dotted segments).
  const atMatch = /^([\d.]+)@(oldest|latest)$/i.exec(alias.trim());
  if (atMatch) {
    if (!manifest) return undefined;
    const [, prefix, qualifier] = atMatch;
    const timeMap     = manifest.time ?? {};
    const versionsMap = manifest.versions ?? {};
    const dotPrefix   = `${prefix}.`;
    const patches = Object.keys(timeMap)
      .filter((ver) => ver.startsWith(dotPrefix) && /^\d+\.\d+\.\d+$/.test(ver))
      .sort((a, b) => compareSemver(a, b));
    if (patches.length === 0) return undefined;
    const resolvedVer = qualifier.toLowerCase() === 'oldest' ? patches[0] : patches[patches.length - 1];
    const angularRange = versionsMap[resolvedVer]?.peerDependencies?.['@angular/core'] ?? '';
    const parts        = resolvedVer.split('.');
    const stableLine   = parts[1] !== '0' ? `${parts[0]}.${parts[1]}` : parts[0];
    const matchingLts  = resolveVersion(resolvedVer, versions);
    return {
      version:        resolvedVer,
      releaseDate:    timeMap[resolvedVer] ?? '',
      angularVersion: extractAngularMajorFromRange(angularRange) ?? matchingLts?.angularVersion ?? 0,
      ltsAlias:       matchingLts?.ltsAlias ?? null,
      stableLine:     matchingLts?.stableLine ?? stableLine,
    };
  }

  // ── Step 2: LTS alias / year alias / exact stable-line match ──────────────
  // Returns the dist-tag version (primaryVersion) paired with the line's
  // initial release date — so getVersionRange date filtering sees the correct
  // start-of-line boundary regardless of how recent the dist-tag patch is.
  //
  // We accept named aliases and exact stable-line strings. Bare SDK major numbers
  // (e.g. "1021") are intentionally excluded — they must use @oldest / @latest.
  // A "named" match is any LTS resolved via ltsAlias, yearAlias, or exact stableLine;
  // the major-only fallback (single-segment input matching a major) is not accepted.
  const lts = resolveVersion(alias, versions);
  if (lts) {
    const n = alias.trim().toLowerCase().replace(/^y/, '');
    const isNamedMatch =
      lts.ltsAlias   === n ||
      lts.ltsAlias   === `${n}-lts` ||
      lts.yearAlias  === n ||
      lts.stableLine === n ||
      (n.includes('.') && isVersionSegmentPrefix(n, lts.stableLine));
    if (isNamedMatch) {
      return {
        version:        lts.primaryVersion,
        releaseDate:    lts.releaseDate,
        angularVersion: lts.angularVersion,
        ltsAlias:       lts.ltsAlias,
        stableLine:     lts.stableLine,
      };
    }
  }

  // ── Step 3: Full semver (X.Y.Z) only ──────────────────────────────────────
  // Partial inputs (single segment or two-segment non-LTS) are not accepted
  // without an explicit @oldest / @latest qualifier.
  if (!/^\d+\.\d+\.\d+$/.test(alias.trim())) return undefined;
  if (!manifest) return undefined;

  const normalized  = alias.trim();
  const timeMap     = manifest.time ?? {};
  const versionsMap = manifest.versions ?? {};

  const makeInputVersion = (ver: string): InputVersion => {
    const angularRange = versionsMap[ver]?.peerDependencies?.['@angular/core'] ?? '';
    const parts        = ver.split('.');
    const stableLine   = parts[1] !== '0' ? `${parts[0]}.${parts[1]}` : parts[0];
    const matchingLts  = resolveVersion(ver, versions);
    return {
      version:        ver,
      releaseDate:    timeMap[ver] ?? '',
      angularVersion: extractAngularMajorFromRange(angularRange) ?? matchingLts?.angularVersion ?? 0,
      ltsAlias:       matchingLts?.ltsAlias ?? null,
      stableLine:     matchingLts?.stableLine ?? stableLine,
    };
  };

  // Exact match
  if (timeMap[normalized]) return makeInputVersion(normalized);

  // Closest version in the same major.minor
  const parts      = normalized.split('.');
  const prefix     = `${parts[0]}.${parts[1]}.`;
  const inputPatch = parseInt(parts[2], 10);

  const candidates = Object.keys(timeMap)
    .filter((ver) => ver.startsWith(prefix) && /^\d+\.\d+\.\d+$/.test(ver))
    .map((ver) => ({ ver, patch: parseInt(ver.split('.')[2], 10) }))
    .filter((c) => !Number.isNaN(c.patch));

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => Math.abs(a.patch - inputPatch) - Math.abs(b.patch - inputPatch));
  return makeInputVersion(candidates[0].ver);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a stable line string from a full semver.
 * "1023.14.50" → "1023.14"  (major.minor, when minor != 0)
 * "1018.0.5"   → "1018"     (major only, when minor is 0)
 *
 * The minor-0 convention: early CD builds ship as x.0.y before the LTS minor
 * is assigned (e.g. 1018.0.5 before 2023-lts settled on stableLine "1018").
 * Using a single-segment stableLine lets `resolveVersion` match them via the
 * major-only fallback rather than accidentally colliding with a future LTS minor.
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



