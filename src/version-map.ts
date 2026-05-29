/**
 * SDK version model and resolution logic.
 *
 * Version data is derived at runtime from npm dist-tags on @c8y/ngx-components.
 * Tags like y2026-lts resolve to a full semver from which the stable line and
 * Angular version (via peerDependencies) are derived.
 *
 * See src/npm-fetcher.ts for how versions are populated.
 */

/**
 * A resolved version from npm — may or may not correspond to an LTS stable line.
 *
 * Used as the canonical from/to type for range calculations, changelog date
 * filtering, and Angular version comparisons.  `SdkVersion` is a superset of
 * this type — every SdkVersion is a valid InputVersion.
 */
export interface InputVersion {
  /** The resolved npm version string, e.g. "1021.0.4" or "1021.22.145" */
  version: string;
  /** ISO 8601 publish date from the npm time map. Empty string when unavailable. */
  releaseDate: string;
  /** Angular major version from peerDependencies. 0 when unavailable. */
  angularVersion: number;
  /** LTS alias when this version belongs to a known LTS line. Null for pre-LTS or CD builds. */
  ltsAlias: string | null;
  /** Stable display line, e.g. "1021.22" for LTS or "1021.0" for a non-LTS CD build. */
  stableLine: string;
}

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
  /**
   * ISO 8601 publish date of the first version in this stable line from the npm registry.
   * Used to map REST API changelog entries (by publish date) to the LTS version that
   * first incorporates them.  Empty string when the npm registry is unavailable.
   */
  releaseDate: string;
}

/**
 * Resolve a version alias string to an SdkVersion.
 *
 * Accepts:
 *  - LTS aliases:           "2025-lts", "2026-lts", "y2025-lts", "y2026-lts"
 *  - Year aliases:          "2025", "2026", "y2025", "y2026"
 *  - Minor / stable:        "1021", "1023", "1021.22", "1021.22.145"
 *
 * For full patch versions with a specified minor (X.Y.Z), the resolution
 * requires an exact minor match against the LTS stable line:
 *  - "1021.22.145" → major 1021, minor 22 = stableLine minor 22 → 2025-lts ✓
 *  - "1021.55.3"   → major 1021, minor 55 ≠ stableLine minor 22 → undefined ✓
 *                    (CD build — not part of any LTS line)
 *  - "1021.0.0"    → major 1021, minor 0  ≠ stableLine minor 22 → undefined ✓
 *
 * Exception: when the LTS stableLine has only one segment (e.g. "1025" for a
 * future LTS whose minor hasn't been assigned yet), any version in the same
 * major resolves to it via major-only matching.
 */
export function resolveVersion(alias: string, versions: SdkVersion[]): SdkVersion | undefined {
  const normalized = alias.trim().toLowerCase().replace(/^y/, '');

  if (!normalized) return undefined;

  // Check if normalized input already ends with -lts (e.g., "2026-lts", "y2026-lts" → "2026-lts")
  // If so, check directly. Otherwise, check both the literal value and with -lts appended.
  const endsWithLts = normalized.endsWith('-lts');
  const direct = versions.find(
    (v) =>
      v.ltsAlias === normalized ||
      (!endsWithLts && v.ltsAlias === `${normalized}-lts`) ||
      v.yearAlias === normalized ||
      v.primaryVersion.startsWith(normalized) ||
      v.stableLine === normalized ||
      v.stableLine.startsWith(normalized),
  );
  if (direct) return direct;

  // Fall back: for versions with a specified minor (e.g. "1021.55.3"), require that
  // the matched stableLine minor ≤ input minor.  This prevents mapping a pre-LTS CD
  // version (e.g. "1021.0.0", minor 0) to an LTS line whose stable minor is higher
  // (e.g. 2025-lts at "1021.22", minor 22).
  //
  // Exception: single-segment stableLines (future/unreleased LTS, e.g. "1025") are
  // still matched by major only — their minor hasn't been established yet.
  const parts = normalized.split('.');
  const major = parts[0];
  if (!major || !/^\d+$/.test(major)) return undefined;

  if (parts.length >= 2 && /^\d+$/.test(parts[1] ?? '')) {
    const inputMinor = parseInt(parts[1], 10);

    // Future LTS: single-segment stableLine matches by major only
    const futureLts = versions.find(
      (v) => v.stableLine.split('.').length === 1 && v.stableLine === major,
    );
    if (futureLts) return futureLts;

    // Settled LTS: stableLine minor must match the input minor exactly.
    // CD builds with a different minor (e.g. "1021.41.x") are not part of any
    // LTS line even if their major matches — only "1021.22.x" belongs to 2025-lts.
    return versions.find((v) => {
      const [lMajor, lMinorStr] = v.stableLine.split('.');
      return lMajor === major && lMinorStr !== undefined && parseInt(lMinorStr, 10) === inputMinor;
    });
  }

  // Input has major only — match by major against any stableLine shape
  return versions.find((v) => v.stableLine.split('.')[0] === major);
}

/**
 * Returns the SDK LTS versions strictly after `from` up to and including `to`,
 * ordered oldest-first.
 *
 * Primary strategy — release-date range (works for LTS and non-LTS inputs):
 *   Return every LTS whose npm releaseDate is strictly after from.releaseDate
 *   and on or before to.releaseDate.  This handles pre-LTS from-versions like
 *   "1021.0.4" correctly: they pick up all LTS lines published after that date.
 *
 * Fallback — LTS index (used when release dates are unavailable, e.g. --no-npm):
 *   Requires both from and to to have a ltsAlias.
 */
export function getVersionRange(
  from: InputVersion,
  to: InputVersion,
  versions: SdkVersion[],
): SdkVersion[] {
  // Same-LTS-line: both endpoints are within the same LTS line (e.g. 1022@oldest → 1022@latest).
  // The toLts.releaseDate cap used below would make fromDate appear newer than toDate, so
  // short-circuit here and return that single LTS entry directly.
  if (from.ltsAlias && from.ltsAlias === to.ltsAlias) {
    const lts = versions.find((v) => v.ltsAlias === to.ltsAlias);
    return lts ? [lts] : [];
  }

  if (from.releaseDate && to.releaseDate) {
    const fromDate = new Date(from.releaseDate).getTime();
    // When `to` belongs to a known LTS line, cap at that line's initial release
    // date rather than the specific patch's date. Without this, a patch like
    // "1021.22.155" published in April 2026 would include 2026-lts in the range
    // even though the user is explicitly staying within the 2025-lts line.
    const toLts = to.ltsAlias ? versions.find((v) => v.ltsAlias === to.ltsAlias) : null;
    const toDateStr = (toLts?.releaseDate) || to.releaseDate;
    const toDate = new Date(toDateStr).getTime();
    if (isNaN(fromDate) || isNaN(toDate) || fromDate >= toDate) return [];
    return versions
      .filter((v) => {
        if (!v.releaseDate) return false;
        const d = new Date(v.releaseDate).getTime();
        return d > fromDate && d <= toDate;
      })
      .sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime());
  }

  // Fallback: index-based (--no-npm or unavailable dates)
  if (!from.ltsAlias || !to.ltsAlias) return [];
  const fromIdx = versions.findIndex((v) => v.ltsAlias === from.ltsAlias);
  const toIdx   = versions.findIndex((v) => v.ltsAlias === to.ltsAlias);
  if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) return [];
  return versions.slice(fromIdx + 1, toIdx + 1);
}
