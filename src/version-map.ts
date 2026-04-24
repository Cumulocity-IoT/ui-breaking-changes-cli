/**
 * SDK version model and resolution logic.
 *
 * Version data is derived at runtime from npm dist-tags on @c8y/ngx-components.
 * Tags like y2026-lts resolve to a full semver from which the stable line and
 * Angular version (via peerDependencies) are derived.
 *
 * See src/npm-fetcher.ts for how versions are populated.
 */

export interface SdkVersion {
  /** LTS alias, e.g. "2026-lts" */
  ltsAlias: string;
  /** Year alias, e.g. "2026" */
  yearAlias: string;
  /** First release in the stable line, e.g. "1023.14.0" */
  primaryVersion: string;
  /** Patch-stable line, e.g. "1023.14" or "1018" */
  stableLine: string;
  /** Angular major version for this SDK line */
  angularVersion: number;
  /** Human-readable support status */
  supportStatus: string;
  /** WebSDK changelog URL for this release year */
  changelogUrl: string;
}

/**
 * Resolve a version alias string to an SdkVersion.
 *
 * Accepts:
 *  - LTS aliases:      "2025-lts", "2026-lts"
 *  - Year aliases:     "2025", "2026", "y2025"
 *  - Minor/patch:      "1021", "1023", "1021.22", "1023.13.2", "1021.22.145"
 *
 * Full patch versions like "1023.13.2" are resolved by their major segment
 * ("1023") to the LTS line whose stableLine starts with that major number.
 * This means 1023.13.2 and 1023.14.0 both resolve to 2026-lts.
 */
export function resolveVersion(alias: string, versions: SdkVersion[]): SdkVersion | undefined {
  const normalized = alias.trim().toLowerCase().replace(/^y/, '');

  if (!normalized) return undefined;

  const direct = versions.find(
    (v) =>
      v.ltsAlias === normalized ||
      v.ltsAlias === `${normalized}-lts` ||
      v.yearAlias === normalized ||
      v.primaryVersion.startsWith(normalized) ||
      v.stableLine === normalized ||
      v.stableLine.startsWith(normalized),
  );
  if (direct) return direct;

  // Fall back: match by major version number only (first segment of a full patch version).
  // e.g. "1023.13.2" → major "1023" → matches stableLine "1023.14"
  const major = normalized.split('.')[0];
  if (major && /^\d+$/.test(major)) {
    return versions.find((v) => v.stableLine.split('.')[0] === major);
  }

  return undefined;
}

/**
 * Returns the SDK versions strictly after `from` up to and including `to`,
 * ordered oldest-first.
 */
export function getVersionRange(
  from: SdkVersion,
  to: SdkVersion,
  versions: SdkVersion[],
): SdkVersion[] {
  // versions is already sorted oldest-first by parseVersionData
  const fromIdx = versions.findIndex((v) => v.ltsAlias === from.ltsAlias);
  const toIdx = versions.findIndex((v) => v.ltsAlias === to.ltsAlias);

  if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) {
    return [];
  }

  return versions.slice(fromIdx + 1, toIdx + 1);
}
