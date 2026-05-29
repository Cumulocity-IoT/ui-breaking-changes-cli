/**
 * Shared utility functions used across multiple modules.
 */

/**
 * True when every dot-separated segment of `prefix` exactly matches the
 * corresponding leading segment of `full`.
 *
 * Prevents raw `startsWith` from matching across segment boundaries:
 *   isVersionSegmentPrefix("1021.1",  "1021.13") → false  (1 ≠ 13)
 *   isVersionSegmentPrefix("1021.2",  "1021.22") → false  (2 ≠ 22)
 *   isVersionSegmentPrefix("1021",    "1021.22") → true   (major-only)
 *   isVersionSegmentPrefix("1021.22", "1021.22") → true   (exact)
 */
export function isVersionSegmentPrefix(prefix: string, full: string): boolean {
  const p = prefix.split('.');
  const f = full.split('.');
  if (p.length > f.length) return false;
  return p.every((seg, i) => seg === f[i]);
}

/**
 * Compare two semver-like strings (e.g. "1021.0.0" vs "1022.8.3").
 *
 * Non-numeric characters are stripped before parsing, so pre-release suffixes
 * (e.g. "1.0.0-rc.1") degrade gracefully to their numeric parts.
 *
 * Returns positive when a > b, negative when a < b, 0 when equal.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/[^0-9.]/g, '').split('.').map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
