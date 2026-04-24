import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArbitraryVersion } from './npm-fetcher.js';
import type { SdkVersion } from './version-map.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeVersion(
  ltsAlias: string,
  yearAlias: string,
  stableLine: string,
  primaryVersion: string,
  angularVersion: number,
  releaseDate = '',
): SdkVersion {
  return { ltsAlias, yearAlias, primaryVersion, stableLine, angularVersion,
           supportStatus: 'active', changelogUrl: 'https://example.com', releaseDate };
}

const VERSIONS: SdkVersion[] = [
  makeVersion('2025-lts', '2025', '1021.22', '1021.22.155', 18, '2025-01-15T00:00:00.000Z'),
  makeVersion('2026-lts', '2026', '1023.14', '1023.14.50',  20, '2026-01-15T00:00:00.000Z'),
];

const MANIFEST = {
  'dist-tags': { latest: '1021.22.155', 'y2025-lts': '1021.22.155', 'y2026-lts': '1023.14.50' },
  time: {
    '1021.0.1':   '2024-06-01T00:00:00.000Z',
    '1021.0.4':   '2024-06-10T00:00:00.000Z',
    '1021.0.7':   '2024-06-20T00:00:00.000Z',
    '1021.22.0':  '2025-01-15T00:00:00.000Z',
    '1021.22.155':'2025-11-01T00:00:00.000Z',
    '1021.41.1':  '2025-11-15T00:00:00.000Z',
    '1021.41.8':  '2025-12-01T00:00:00.000Z',
    '1023.14.0':  '2026-01-15T00:00:00.000Z',
    '1023.14.50': '2026-04-01T00:00:00.000Z',
  },
  versions: {
    '1021.0.1':   { peerDependencies: { '@angular/core': '^18.0.0' } },
    '1021.0.4':   { peerDependencies: { '@angular/core': '^18.0.0' } },
    '1021.0.7':   { peerDependencies: { '@angular/core': '^18.0.0' } },
    '1021.22.0':  { peerDependencies: { '@angular/core': '^18.0.0' } },
    '1021.22.155':{ peerDependencies: { '@angular/core': '^18.0.0' } },
    '1021.41.1':  { peerDependencies: { '@angular/core': '^18.0.0' } },
    '1021.41.8':  { peerDependencies: { '@angular/core': '^18.0.0' } },
    '1023.14.0':  { peerDependencies: { '@angular/core': '^20.0.0' } },
    '1023.14.50': { peerDependencies: { '@angular/core': '^20.0.0' } },
  },
};

// ── resolveArbitraryVersion ───────────────────────────────────────────────────

describe('resolveArbitraryVersion', () => {

  // ── Step 1: @oldest / @latest ───────────────────────────────────────────────
  describe('@oldest / @latest range selector', () => {
    it('"1021@oldest" picks the earliest patch in 1021.x.x', () => {
      const r = resolveArbitraryVersion('1021@oldest', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.0.1');
    });

    it('"1021@latest" picks the latest patch in 1021.x.x', () => {
      const r = resolveArbitraryVersion('1021@latest', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.41.8');
    });

    it('"1021.22@oldest" picks the earliest patch in 1021.22.x and sets ltsAlias', () => {
      const r = resolveArbitraryVersion('1021.22@oldest', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.22.0');
      assert.equal(r.ltsAlias, '2025-lts');
    });

    it('"1021.22@latest" picks the latest patch in 1021.22.x', () => {
      const r = resolveArbitraryVersion('1021.22@latest', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.22.155');
      assert.equal(r.ltsAlias, '2025-lts');
    });

    it('"1021.41@oldest" picks earliest in the CD minor line (no ltsAlias)', () => {
      const r = resolveArbitraryVersion('1021.41@oldest', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.41.1');
      assert.equal(r.ltsAlias, null);
    });

    it('"1021.41@latest" picks latest in the CD minor line', () => {
      const r = resolveArbitraryVersion('1021.41@latest', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.41.8');
    });

    it('is case-insensitive (@OLDEST, @Latest)', () => {
      const r1 = resolveArbitraryVersion('1021@OLDEST', VERSIONS, MANIFEST);
      const r2 = resolveArbitraryVersion('1021@Latest', VERSIONS, MANIFEST);
      assert.equal(r1?.version, '1021.0.1');
      assert.equal(r2?.version, '1021.41.8');
    });

    it('returns undefined when no patches match the prefix', () => {
      assert.equal(resolveArbitraryVersion('9999@oldest', VERSIONS, MANIFEST), undefined);
    });

    it('returns undefined when manifest is null', () => {
      assert.equal(resolveArbitraryVersion('1021@latest', VERSIONS, null), undefined);
    });
  });

  // ── Step 2: LTS alias / year alias / exact stable-line ─────────────────────
  describe('LTS alias / year alias / exact stable-line', () => {
    it('"2025-lts" resolves to primaryVersion with LTS releaseDate', () => {
      const r = resolveArbitraryVersion('2025-lts', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.22.155');
      assert.equal(r.releaseDate, '2025-01-15T00:00:00.000Z'); // LTS line initial date
      assert.equal(r.ltsAlias, '2025-lts');
      assert.equal(r.angularVersion, 18);
    });

    it('"2026-lts" resolves to primaryVersion with LTS releaseDate', () => {
      const r = resolveArbitraryVersion('2026-lts', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1023.14.50');
      assert.equal(r.releaseDate, '2026-01-15T00:00:00.000Z');
      assert.equal(r.ltsAlias, '2026-lts');
    });

    it('year alias "2025" resolves to 2025-lts primaryVersion', () => {
      const r = resolveArbitraryVersion('2025', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.22.155');
      assert.equal(r.ltsAlias, '2025-lts');
    });

    it('y-prefix alias "y2026" resolves to 2026-lts', () => {
      const r = resolveArbitraryVersion('y2026', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.ltsAlias, '2026-lts');
    });

    it('exact stable-line "1021.22" resolves to 2025-lts primaryVersion', () => {
      const r = resolveArbitraryVersion('1021.22', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.22.155');
      assert.equal(r.ltsAlias, '2025-lts');
      assert.equal(r.releaseDate, '2025-01-15T00:00:00.000Z');
    });

    it('works without a manifest (versions only)', () => {
      const r = resolveArbitraryVersion('2025-lts', VERSIONS, null);
      assert.ok(r);
      assert.equal(r.version, '1021.22.155');
    });
  });

  // ── Step 3: full semver X.Y.Z ──────────────────────────────────────────────
  describe('full semver (X.Y.Z)', () => {
    it('exact match returns the version with its actual publish date', () => {
      const r = resolveArbitraryVersion('1021.0.4', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.0.4');
      assert.equal(r.releaseDate, '2024-06-10T00:00:00.000Z');
      assert.equal(r.ltsAlias, null);
      assert.equal(r.angularVersion, 18);
    });

    it('exact match within LTS line keeps ltsAlias', () => {
      const r = resolveArbitraryVersion('1021.22.155', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.22.155');
      assert.equal(r.ltsAlias, '2025-lts');
    });

    it('closest-match: "1021.0.0" → "1021.0.1" (nearest published)', () => {
      const r = resolveArbitraryVersion('1021.0.0', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.0.1');
    });

    it('closest-match: "1021.0.5" → "1021.0.4"', () => {
      const r = resolveArbitraryVersion('1021.0.5', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.0.4');
    });

    it('closest-match: "1021.0.6" → "1021.0.7"', () => {
      const r = resolveArbitraryVersion('1021.0.6', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.version, '1021.0.7');
    });

    it('returns undefined when no patch exists in the major.minor', () => {
      assert.equal(resolveArbitraryVersion('9999.0.0', VERSIONS, MANIFEST), undefined);
    });

    it('returns undefined when manifest is null', () => {
      assert.equal(resolveArbitraryVersion('1021.0.4', VERSIONS, null), undefined);
    });
  });

  // ── Partial inputs without @oldest/@latest → undefined ─────────────────────
  describe('partial inputs (no @oldest/@latest) return undefined', () => {
    it('bare major "1021" returns undefined', () => {
      assert.equal(resolveArbitraryVersion('1021', VERSIONS, MANIFEST), undefined);
    });

    it('non-LTS two-segment "1021.41" returns undefined', () => {
      assert.equal(resolveArbitraryVersion('1021.41', VERSIONS, MANIFEST), undefined);
    });

    it('non-LTS two-segment "1021.0" returns undefined', () => {
      assert.equal(resolveArbitraryVersion('1021.0', VERSIONS, MANIFEST), undefined);
    });

    it('empty string returns undefined', () => {
      assert.equal(resolveArbitraryVersion('', VERSIONS, MANIFEST), undefined);
    });
  });

  // ── stableLine derivation ───────────────────────────────────────────────────
  describe('stableLine derivation for non-LTS full semvers', () => {
    it('"1021.0.4" gets stableLine "1021" (minor 0 dropped)', () => {
      const r = resolveArbitraryVersion('1021.0.4', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.stableLine, '1021');
    });

    it('"1023.14.50" gets stableLine "1023.14" from LTS (minor != 0)', () => {
      const r = resolveArbitraryVersion('1023.14.50', VERSIONS, MANIFEST);
      assert.ok(r);
      assert.equal(r.stableLine, '1023.14');
    });
  });
});
