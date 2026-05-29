import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVersion, getVersionRange } from './version-map.ts';
import type { InputVersion, SdkVersion } from './version-map.ts';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeVersion(
  ltsAlias: string,
  yearAlias: string,
  stableLine: string,
  primaryVersion: string,
  angularVersion: number,
  releaseDate = '',
): SdkVersion {
  return {
    ltsAlias,
    yearAlias,
    primaryVersion,
    stableLine,
    angularVersion,
    supportStatus: 'active',
    changelogUrl: 'https://example.com',
    releaseDate,
  };
}

/** Ordered oldest-first, matching real version-map ordering. */
const VERSIONS: SdkVersion[] = [
  makeVersion('2023-lts', '2023', '1018',    '1018.0.0',  16, '2023-01-15T00:00:00.000Z'),
  makeVersion('2024-lts', '2024', '1019.0',  '1019.0.0',  17, '2024-01-15T00:00:00.000Z'),
  makeVersion('2025-lts', '2025', '1021.22', '1021.22.0', 18, '2025-01-15T00:00:00.000Z'),
  makeVersion('2026-lts', '2026', '1023.14', '1023.14.0', 20, '2026-01-15T00:00:00.000Z'),
];

const [v2023, v2024, v2025, v2026] = VERSIONS as [SdkVersion, SdkVersion, SdkVersion, SdkVersion];

// ── resolveVersion ────────────────────────────────────────────────────────────

describe('resolveVersion', () => {
  describe('LTS aliases', () => {
    it('resolves "2025-lts"', () => {
      assert.equal(resolveVersion('2025-lts', VERSIONS), v2025);
    });
    it('resolves "2026-lts"', () => {
      assert.equal(resolveVersion('2026-lts', VERSIONS), v2026);
    });
    it('resolves "y2025-lts" (y-prefix with -lts suffix)', () => {
      assert.equal(resolveVersion('y2025-lts', VERSIONS), v2025);
    });
    it('resolves "y2026-lts" (y-prefix with -lts suffix)', () => {
      assert.equal(resolveVersion('y2026-lts', VERSIONS), v2026);
    });
    it('resolves "Y2025-LTS" (Y-prefix, uppercase)', () => {
      assert.equal(resolveVersion('Y2025-LTS', VERSIONS), v2025);
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
    it('resolves major-only "1021" via segment-prefix match', () => {
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
    it('resolves "1021.22.145" via minor-segment fallback', () => {
      assert.equal(resolveVersion('1021.22.145', VERSIONS), v2025);
    });
    it('resolves "1023.14.0" via exact primaryVersion match', () => {
      assert.equal(resolveVersion('1023.14.0', VERSIONS), v2026);
    });
    it('does NOT resolve "1021.55.3" — CD build, minor 55 ≠ stableLine minor 22', () => {
      assert.equal(resolveVersion('1021.55.3', VERSIONS), undefined);
    });
    it('does NOT resolve "1023.24.1" — CD build, minor 24 ≠ stableLine minor 14', () => {
      assert.equal(resolveVersion('1023.24.1', VERSIONS), undefined);
    });
    it('does NOT resolve "1021.0.0" — minor 0 ≠ stableLine minor 22', () => {
      assert.equal(resolveVersion('1021.0.0', VERSIONS), undefined);
    });
    it('does NOT resolve "1021.21.5" — minor 21 ≠ stableLine minor 22', () => {
      assert.equal(resolveVersion('1021.21.5', VERSIONS), undefined);
    });
    it('does NOT resolve "1023.13.2" — minor 13 ≠ stableLine minor 14', () => {
      assert.equal(resolveVersion('1023.13.2', VERSIONS), undefined);
    });
  });

  describe('single-segment stableLine (future/unreleased LTS)', () => {
    it('resolves "1018.0.0" to 2023-lts via major-only (stableLine "1018" has no minor)', () => {
      assert.equal(resolveVersion('1018.0.0', VERSIONS), v2023);
    });
    it('resolves "1018.5.2" to 2023-lts via major-only (stableLine "1018" has no minor)', () => {
      assert.equal(resolveVersion('1018.5.2', VERSIONS), v2023);
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
  describe('date-based range (primary path — from and to have releaseDates)', () => {
    it('returns versions strictly after from up to and including to (multi-hop)', () => {
      const range = getVersionRange(v2023, v2026, VERSIONS);
      assert.deepEqual(range, [v2024, v2025, v2026]);
    });

    it('returns single version for adjacent versions', () => {
      const range = getVersionRange(v2025, v2026, VERSIONS);
      assert.deepEqual(range, [v2026]);
    });

    it('returns [lts] when from and to are the same LTS version (same-line short-circuit)', () => {
      // Same ltsAlias → short-circuit returns that single LTS entry so the
      // caller can still show the changelog (e.g. --from 2025-lts --to 2025-lts).
      const range = getVersionRange(v2025, v2025, VERSIONS);
      assert.deepEqual(range, [v2025]);
    });

    it('returns [] when from is newer than to (downgrade not allowed)', () => {
      const range = getVersionRange(v2026, v2025, VERSIONS);
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

  describe('non-LTS from version (pre-LTS CD build or arbitrary npm version)', () => {
    // A CD build from mid-2023 — before 2024-lts, 2025-lts, and 2026-lts were released
    const preLts2024: InputVersion = {
      version: '1018.5.3',
      releaseDate: '2023-07-01T00:00:00.000Z',
      angularVersion: 16,
      ltsAlias: null,
      stableLine: '1018.5',
    };

    it('includes all LTS versions released after the from date', () => {
      const range = getVersionRange(preLts2024, v2026, VERSIONS);
      assert.deepEqual(range, [v2024, v2025, v2026]);
    });

    it('returns partial range when to is an intermediate LTS', () => {
      const range = getVersionRange(preLts2024, v2025, VERSIONS);
      assert.deepEqual(range, [v2024, v2025]);
    });

    it('does NOT include 2026-lts when to is a specific patch within 2025-lts released after 2026-lts launched', () => {
      // Simulates: --from 1021.0.0 --to 1021.22.155 where 1021.22.155 was
      // published in 2026 (after 2026-lts launched), but the user is staying
      // within the 2025-lts stable line.
      const latePatchIn2025Lts: InputVersion = {
        version: '1021.22.155',
        releaseDate: '2026-03-01T00:00:00.000Z', // published after 2026-lts launched
        angularVersion: 18,
        ltsAlias: '2025-lts',
        stableLine: '1021.22',
      };
      const preLts2025: InputVersion = {
        version: '1021.0.0',
        releaseDate: '2024-06-01T00:00:00.000Z',
        angularVersion: 17,
        ltsAlias: null,
        stableLine: '1021.0',
      };
      const range = getVersionRange(preLts2025, latePatchIn2025Lts, VERSIONS);
      assert.deepEqual(range, [v2025]);
    });

    it('excludes the 2023-lts (its date is before or equal to the from date)', () => {
      const range = getVersionRange(preLts2024, v2026, VERSIONS);
      assert.ok(!range.includes(v2023));
    });
  });

  describe('fallback: LTS-index range when release dates are unavailable (e.g. --no-npm)', () => {
    const noDateFrom: InputVersion = { version: '1021.22.0', releaseDate: '', angularVersion: 18, ltsAlias: '2025-lts', stableLine: '1021.22' };
    const noDateTo: InputVersion   = { version: '1023.14.0', releaseDate: '', angularVersion: 20, ltsAlias: '2026-lts', stableLine: '1023.14' };

    it('falls back to LTS index when both endpoints have a known ltsAlias', () => {
      const range = getVersionRange(noDateFrom, noDateTo, VERSIONS);
      assert.deepEqual(range, [v2026]);
    });

    it('returns [] when from has no date and no ltsAlias (range cannot be determined)', () => {
      const noDateNoLts: InputVersion = { version: '1018.5.3', releaseDate: '', angularVersion: 16, ltsAlias: null, stableLine: '1018.5' };
      const range = getVersionRange(noDateNoLts, noDateTo, VERSIONS);
      assert.deepEqual(range, []);
    });
  });
});

// ── CD release scenarios ──────────────────────────────────────────────────────
//
// CD (continuous delivery) releases are individual npm patches whose minor does
// NOT match any LTS stable line (e.g. 1021.55.3, 1023.71.1).
//
// resolveVersion returns undefined for these — they are not part of any LTS line.
// The CLI uses resolveArbitraryVersion (which adds a releaseDate) and getVersionRange
// uses date-based filtering to determine which LTS lines fall in between.
//
// The tests here verify that:
//   resolveVersion returns undefined for CD builds
//   getVersionRange with InputVersion objects (dates) handles CD→CD correctly

describe('CD release scenarios', () => {
  // CD builds now return undefined from resolveVersion — they are not in any LTS line
  describe('resolveVersion returns undefined for CD builds (wrong minor)', () => {
    it('"1021.55.3" is NOT in any LTS line (minor 55 ≠ 22)', () => {
      assert.equal(resolveVersion('1021.55.3', VERSIONS), undefined);
    });

    it('"1023.71.1" is NOT in any LTS line (minor 71 ≠ 14)', () => {
      assert.equal(resolveVersion('1023.71.1', VERSIONS), undefined);
    });

    it('"1023.68.0" is NOT in any LTS line (minor 68 ≠ 14)', () => {
      assert.equal(resolveVersion('1023.68.0', VERSIONS), undefined);
    });
  });

  // Cross-line upgrade: older CD on 2025-lts line → current CD on 2026-lts line.
  // The CLI provides InputVersions with releaseDates; getVersionRange uses dates.
  describe('older CD from previous LTS line vs current CD (cross-line upgrade)', () => {
    // Represents 1021.55.3 — published mid-2025 (between 2025-lts and 2026-lts)
    const fromCd: InputVersion = {
      version: '1021.55.3',
      releaseDate: '2025-07-01T00:00:00.000Z',
      angularVersion: 18,
      ltsAlias: null,
      stableLine: '1021.55',
    };
    // Represents 1023.71.1 — published mid-2026 (after 2026-lts)
    const toCd: InputVersion = {
      version: '1023.71.1',
      releaseDate: '2026-07-01T00:00:00.000Z',
      angularVersion: 20,
      ltsAlias: null,
      stableLine: '1023.71',
    };

    it('produces a non-empty version range (2026-lts falls between the two dates)', () => {
      const range = getVersionRange(fromCd, toCd, VERSIONS);
      assert.deepEqual(range, [v2026]);
    });
  });

  // Same-line CD upgrade: both builds published within the 2026-lts era.
  describe('older CD build vs current CD within the same LTS line (no-op)', () => {
    const olderCd: InputVersion = {
      version: '1023.68.0',
      releaseDate: '2026-03-01T00:00:00.000Z',
      angularVersion: 20,
      ltsAlias: null,
      stableLine: '1023.68',
    };
    const newerCd: InputVersion = {
      version: '1023.71.1',
      releaseDate: '2026-07-01T00:00:00.000Z',
      angularVersion: 20,
      ltsAlias: null,
      stableLine: '1023.71',
    };

    it('returns [] — no LTS lines were released between the two CD builds', () => {
      const range = getVersionRange(olderCd, newerCd, VERSIONS);
      assert.deepEqual(range, []);
    });
  });
});

// ── getVersionRange — same-LTS-line short-circuit ─────────────────────────────
//
// When both from and to belong to the same LTS alias (e.g. 1022@oldest → 1022@latest),
// the date-based path would incorrectly report fromDate >= toDate because it caps
// toDate to the LTS line's *initial* release date (which predates any later patch).
// The short-circuit returns [lts] immediately before that comparison.

describe('getVersionRange — same-LTS-line short-circuit', () => {
  // Simulate 1022@oldest and 1022@latest both resolving to 2025-lts
  const oldestPatch: InputVersion = {
    version: '1021.22.0',
    releaseDate: '2025-01-20T00:00:00.000Z', // older patch, but after the line's .0 release
    angularVersion: 18,
    ltsAlias: '2025-lts',
    stableLine: '1021.22',
  };
  const latestPatch: InputVersion = {
    version: '1021.22.155',
    releaseDate: '2026-03-01T00:00:00.000Z', // much newer patch date
    angularVersion: 18,
    ltsAlias: '2025-lts',
    stableLine: '1021.22',
  };

  it('returns [lts] when from and to share the same ltsAlias (same-line upgrade)', () => {
    const range = getVersionRange(oldestPatch, latestPatch, VERSIONS);
    assert.deepEqual(range, [v2025]);
  });

  it('returns [lts] even when from patch date is newer than toLts.releaseDate', () => {
    // Concrete case that triggered the original bug:
    // oldestPatch.releaseDate (2025-01-20) > toLts.releaseDate (2025-01-15)
    // Without the short-circuit this reports "from is newer than to".
    assert.ok(new Date(oldestPatch.releaseDate) > new Date(v2025.releaseDate));
    const range = getVersionRange(oldestPatch, latestPatch, VERSIONS);
    assert.deepEqual(range, [v2025]);
  });

  it('returns [lts] when from === to (same exact version, same alias)', () => {
    const range = getVersionRange(oldestPatch, oldestPatch, VERSIONS);
    assert.deepEqual(range, [v2025]);
  });

  it('falls back to [lts] even without release dates when aliases match', () => {
    const noDateOldest: InputVersion = { ...oldestPatch, releaseDate: '' };
    const noDateLatest: InputVersion = { ...latestPatch, releaseDate: '' };
    const range = getVersionRange(noDateOldest, noDateLatest, VERSIONS);
    assert.deepEqual(range, [v2025]);
  });

  it('does NOT trigger for patches in different LTS lines', () => {
    // from=2025-lts, to=2026-lts must still return the multi-hop date path
    const range = getVersionRange(oldestPatch, v2026, VERSIONS);
    assert.deepEqual(range, [v2026]);
  });
});

// ── getVersionRange — date boundary conditions ────────────────────────────────

describe('getVersionRange — date boundary conditions', () => {
  it('excludes an LTS version published on exactly the same date as from (strict d > fromDate)', () => {
    // from.releaseDate == v2024.releaseDate → d > fromDate is false → v2024 excluded
    const fromExactlyAt2024: InputVersion = {
      version: '1019.0.0',
      releaseDate: v2024?.releaseDate,
      angularVersion: 17,
      ltsAlias: null,
      stableLine: '1019.0',
    };
    const range = getVersionRange(fromExactlyAt2024, v2026, VERSIONS);
    assert.ok(!range.includes(v2024), 'v2024 must be excluded (from date equals its release date)');
    assert.ok(range.includes(v2025));
    assert.ok(range.includes(v2026));
  });

  it('includes an LTS version published 1 ms after from', () => {
    const justBefore2024: InputVersion = {
      version: '1019.0.0',
      releaseDate: new Date(new Date(v2024?.releaseDate).getTime() - 1).toISOString(),
      angularVersion: 17,
      ltsAlias: null,
      stableLine: '1019.0',
    };
    const range = getVersionRange(justBefore2024, v2026, VERSIONS);
    assert.ok(range.includes(v2024));
  });

  it('returns [] when versions list is empty', () => {
    const range = getVersionRange(v2023, v2026, []);
    assert.deepEqual(range, []);
  });
});

// ── resolveVersion — additional edge cases ────────────────────────────────────

describe('resolveVersion — additional edge cases', () => {
  it('trims surrounding whitespace', () => {
    assert.equal(resolveVersion('  2025-lts  ', VERSIONS), v2025);
  });

  it('trims whitespace on year alias', () => {
    assert.equal(resolveVersion(' 2026 ', VERSIONS), v2026);
  });

  it('resolves "1019.0" exact stable line (minor is 0)', () => {
    assert.equal(resolveVersion('1019.0', VERSIONS), v2024);
  });

  it('does NOT resolve "1021.2" — segment 2 ≠ segment 22', () => {
    assert.equal(resolveVersion('1021.2', VERSIONS), undefined);
  });

  it('does NOT resolve "1021.1" — segment 1 ≠ segment 22', () => {
    assert.equal(resolveVersion('1021.1', VERSIONS), undefined);
  });

  it('does NOT resolve "1021.1" against stableLine "1021.13" — segment 1 ≠ segment 13', () => {
    const withLine13 = [...VERSIONS, makeVersion('2027-lts', '2027', '1021.13', '1021.13.0', 22)];
    assert.equal(resolveVersion('1021.1', withLine13), undefined);
  });

  it('returns undefined for empty versions list', () => {
    assert.equal(resolveVersion('2025-lts', []), undefined);
  });

  it('returns undefined for whitespace-only input', () => {
    assert.equal(resolveVersion('   ', VERSIONS), undefined);
  });
});

