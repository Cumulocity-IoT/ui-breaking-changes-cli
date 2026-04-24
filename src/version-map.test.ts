import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVersion, getVersionRange } from './version-map.js';
import type { SdkVersion } from './version-map.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeVersion(
  ltsAlias: string,
  yearAlias: string,
  stableLine: string,
  primaryVersion: string,
  angularVersion: number,
): SdkVersion {
  return {
    ltsAlias,
    yearAlias,
    primaryVersion,
    stableLine,
    angularVersion,
    supportStatus: 'active',
    changelogUrl: 'https://example.com',
    upgradeSkillName: `websdk-${stableLine.split('.')[0]}-upgrade`,
  };
}

/** Ordered oldest-first, matching real version-map ordering. */
const VERSIONS: SdkVersion[] = [
  makeVersion('2023-lts', '2023', '1018',    '1018.0.0',  16),
  makeVersion('2024-lts', '2024', '1019.0',  '1019.0.0',  17),
  makeVersion('2025-lts', '2025', '1021.22', '1021.22.0', 18),
  makeVersion('2026-lts', '2026', '1023.14', '1023.14.0', 20),
];

const [v2023, v2024, v2025, v2026] = VERSIONS;

// ── resolveVersion ────────────────────────────────────────────────────────────

describe('resolveVersion', () => {
  describe('LTS aliases', () => {
    it('resolves "2025-lts"', () => {
      assert.equal(resolveVersion('2025-lts', VERSIONS), v2025);
    });
    it('resolves "2026-lts"', () => {
      assert.equal(resolveVersion('2026-lts', VERSIONS), v2026);
    });
    it('is case-insensitive', () => {
      assert.equal(resolveVersion('2025-LTS', VERSIONS), v2025);
    });
  });

  describe('year aliases', () => {
    it('resolves bare year "2025"', () => {
      assert.equal(resolveVersion('2025', VERSIONS), v2025);
    });
    it('resolves "y2025" (y-prefix)', () => {
      assert.equal(resolveVersion('y2025', VERSIONS), v2025);
    });
    it('resolves "Y2026" (Y-prefix, upper)', () => {
      assert.equal(resolveVersion('Y2026', VERSIONS), v2026);
    });
  });

  describe('minor / stable-line versions', () => {
    it('resolves exact stable line "1021.22"', () => {
      assert.equal(resolveVersion('1021.22', VERSIONS), v2025);
    });
    it('resolves major-only "1021" via stableLine.startsWith', () => {
      assert.equal(resolveVersion('1021', VERSIONS), v2025);
    });
    it('resolves major-only "1018" (single-segment stableLine)', () => {
      assert.equal(resolveVersion('1018', VERSIONS), v2023);
    });
    it('resolves "1019" via major fallback', () => {
      assert.equal(resolveVersion('1019', VERSIONS), v2024);
    });
  });

  describe('full patch versions', () => {
    it('resolves "1021.22.145" via stableLine.startsWith direct match', () => {
      assert.equal(resolveVersion('1021.22.145', VERSIONS), v2025);
    });
    it('resolves "1023.13.2" via major fallback (1023 → 2026-lts)', () => {
      assert.equal(resolveVersion('1023.13.2', VERSIONS), v2026);
    });
    it('resolves "1023.14.0" via primaryVersion.startsWith direct match', () => {
      assert.equal(resolveVersion('1023.14.0', VERSIONS), v2026);
    });
  });

  describe('unknown aliases', () => {
    it('returns undefined for completely unknown alias', () => {
      assert.equal(resolveVersion('unknown', VERSIONS), undefined);
    });
    it('returns undefined for empty string', () => {
      assert.equal(resolveVersion('', VERSIONS), undefined);
    });
    it('returns undefined for a future year not in list', () => {
      assert.equal(resolveVersion('2030-lts', VERSIONS), undefined);
    });
  });
});

// ── getVersionRange ───────────────────────────────────────────────────────────

describe('getVersionRange', () => {
  it('returns versions strictly after from up to and including to (multi-hop)', () => {
    const range = getVersionRange(v2023, v2026, VERSIONS);
    assert.deepEqual(range, [v2024, v2025, v2026]);
  });

  it('returns single version for adjacent versions', () => {
    const range = getVersionRange(v2025, v2026, VERSIONS);
    assert.deepEqual(range, [v2026]);
  });

  it('returns [] when from and to are the same version', () => {
    const range = getVersionRange(v2025, v2025, VERSIONS);
    assert.deepEqual(range, []);
  });

  it('returns [] when from is newer than to (downgrade not allowed)', () => {
    const range = getVersionRange(v2026, v2025, VERSIONS);
    assert.deepEqual(range, []);
  });

  it('returns [] when from is the latest known version and to is also latest', () => {
    const range = getVersionRange(v2026, v2026, VERSIONS);
    assert.deepEqual(range, []);
  });

  it('skips the from version itself (from-exclusive range)', () => {
    const range = getVersionRange(v2023, v2025, VERSIONS);
    assert.ok(!range.includes(v2023), 'from version must not be in range');
    assert.deepEqual(range, [v2024, v2025]);
  });

  it('includes the to version itself (to-inclusive range)', () => {
    const range = getVersionRange(v2024, v2026, VERSIONS);
    assert.ok(range.includes(v2026), 'to version must be in range');
  });
});

// ── CD release scenarios ──────────────────────────────────────────────────────
//
// CD (continuous delivery) releases are individual npm patches, e.g. 1021.55.3.
// fetchLatestCdVersion() returns the `latest` dist-tag from npm (e.g. "1023.71.1").
// That version string is then passed to resolveVersion just like any other patch.
//
// The CLI resolves both --from and --to to their LTS lines and compares those.
// Consequently:
//
//   --from 1021.55.3  → 2025-lts
//   --to   1023.71.1  → 2026-lts   (from `cd` alias resolved via npm)
//   → range: [v2026]  → shows 2025→2026 breaking changes  ✔
//
//   --from 1023.68.0  → 2026-lts
//   --to   1023.71.1  → 2026-lts   (from `cd` alias resolved via npm)
//   → range: []       → "same version" error  ✔  (no cross-line changes)

describe('CD release scenarios', () => {
  // Simulates: user was on a CD build 3 weeks ago on the 2025-lts line and
  // wants to know what breaks upgrading to today's CD release (2026-lts line).
  describe('older CD from previous LTS line vs current CD (cross-line upgrade)', () => {
    const olderCdVersion = '1021.55.3';   // a 2025-lts CD build from ~3 weeks ago
    const currentCdVersion = '1023.71.1'; // today's `latest` tag on npm (2026-lts)

    it('resolves older CD build to 2025-lts', () => {
      assert.equal(resolveVersion(olderCdVersion, VERSIONS), v2025);
    });

    it('resolves current CD build (from npm latest) to 2026-lts', () => {
      assert.equal(resolveVersion(currentCdVersion, VERSIONS), v2026);
    });

    it('produces a non-empty version range (2025→2026)', () => {
      const from = resolveVersion(olderCdVersion, VERSIONS)!;
      const to   = resolveVersion(currentCdVersion, VERSIONS)!;
      const range = getVersionRange(from, to, VERSIONS);
      assert.deepEqual(range, [v2026]);
    });
  });

  // Simulates: user was on a CD build 3 weeks ago *within the same LTS line*.
  // Both resolve to 2026-lts, so the CLI correctly returns an empty range.
  describe('older CD build vs current CD within the same LTS line (no-op)', () => {
    const olderCdVersion  = '1023.68.0';  // 2026-lts CD build from ~3 weeks ago
    const currentCdVersion = '1023.71.1'; // today's `latest` tag on npm (2026-lts)

    it('both versions resolve to the same LTS line (2026-lts)', () => {
      assert.equal(resolveVersion(olderCdVersion, VERSIONS),  v2026);
      assert.equal(resolveVersion(currentCdVersion, VERSIONS), v2026);
    });

    it('returns [] — no cross-line breaking changes to report', () => {
      const from = resolveVersion(olderCdVersion, VERSIONS)!;
      const to   = resolveVersion(currentCdVersion, VERSIONS)!;
      const range = getVersionRange(from, to, VERSIONS);
      assert.deepEqual(range, []);
    });
  });
});
