import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchAngularBreakingChanges,
  parseAngularReleaseBody,
} from './angular-changelog-fetcher.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Angular 19 style: "## Breaking Changes" section at the TOP of the body.
// Angular 20 style: "## Breaking Changes" section at the BOTTOM, after per-package
//   feature tables that use "| Commit | Type | Description |" format.

const ANGULAR19_FIXTURE = `
## Breaking Changes

### compiler

- \`this.foo\` property reads no longer refer to template context variables.

### core

- Angular directives, components and pipes are now standalone by default.
- TypeScript versions less than 5.5 are no longer supported.
- Timing changes for \`effect\` API (in developer preview):
  * effects are no longer synchronous
  * effects now run before change detection completes

### animations

- The \`BrowserAnimationsModule\` has been moved to a new lazy import.

## Features

### core

| Commit | Type | Description |
| -- | -- | -- |
| abc123 | feat | new signal API |
`.trim();

// Angular 20 style: Breaking Changes section appears AFTER feature tables
const ANGULAR20_FIXTURE = `
## Features

### core

| Commit | Type | Description |
| -- | -- | -- |
| abc123 | feat | new signal API |
| def456 | feat | resource() API |

### common

| Commit | Type | Description |
| -- | -- | -- |
| 789abc | feat | date pipe improvements |

## Breaking Changes

### core

- TypeScript versions less than 5.8 are no longer supported.
- \`TestBed.flushEffects\` has been removed. Use \`TestBed.tick\` instead.
- \`InjectFlags\` enum has been removed.

### router

- \`RouterLinkWithHref\` has been removed. Use \`RouterLink\` directly.
`.trim();

// Fixture with only a feature table under Breaking Changes — should be skipped
const FEATURE_TABLE_ONLY_FIXTURE = `
## Breaking Changes

### core

| Commit | Type | Description |
| -- | -- | -- |
| abc | feat | something |
`.trim();

// ─── Unit tests: parseAngularReleaseBody ─────────────────────────────────────

describe('parseAngularReleaseBody', () => {
  it('returns [] for an empty string', () => {
    const result = parseAngularReleaseBody('', 19, '2026-lts');
    assert.deepEqual(result, []);
  });

  it('returns [] when there is no ## Breaking Changes section', () => {
    const body = '## Features\n\n### core\n\n- some feature\n';
    assert.deepEqual(parseAngularReleaseBody(body, 19, '2026-lts'), []);
  });

  it('parses Angular 19-style body (section at top)', () => {
    const result = parseAngularReleaseBody(ANGULAR19_FIXTURE, 19, '2026-lts');

    assert.ok(result.length > 0, 'expected at least one breaking change');

    // All entries have required fields
    for (const change of result) {
      assert.equal(change.category, 'angular');
      assert.equal(change.severity, 'BREAKING');
      assert.equal(change.introducedIn, '2026-lts');
      assert.ok(change.title.startsWith('Angular 19 (@angular/'), `bad title: ${change.title}`);
      assert.ok(change.sourceUrl?.includes('angular/angular/releases/tag/19.0.0'));
      assert.ok(typeof change.description === 'string' && change.description.length > 0);
    }
  });

  it('extracts the correct package name for each Angular 19 breaking change', () => {
    const result = parseAngularReleaseBody(ANGULAR19_FIXTURE, 19, '2026-lts');
    const packages = result.map((c) => {
      const m = c.title.match(/@angular\/([^)]+)/);
      return m?.[1] ?? '';
    });
    assert.ok(packages.includes('compiler'), 'expected compiler package');
    assert.ok(packages.includes('core'), 'expected core package');
    assert.ok(packages.includes('animations'), 'expected animations package');
  });

  it('parses Angular 20-style body (section at bottom, after feature tables)', () => {
    const result = parseAngularReleaseBody(ANGULAR20_FIXTURE, 20, '2026-lts');

    assert.ok(result.length > 0, 'expected at least one breaking change');

    for (const change of result) {
      assert.equal(change.category, 'angular');
      assert.equal(change.severity, 'BREAKING');
      assert.ok(change.title.startsWith('Angular 20 (@angular/'), `bad title: ${change.title}`);
      assert.ok(change.sourceUrl?.includes('angular/angular/releases/tag/20.0.0'));
    }
  });

  it('skips feature-table subsections under Breaking Changes', () => {
    const result = parseAngularReleaseBody(FEATURE_TABLE_ONLY_FIXTURE, 20, '2026-lts');
    assert.deepEqual(result, []);
  });

  it('skips bullets shorter than 10 characters', () => {
    const body = `
## Breaking Changes

### core

- No.
- This bullet is long enough to be included as a breaking change description.
`.trim();
    const result = parseAngularReleaseBody(body, 20, '2026-lts');
    assert.equal(result.length, 1);
    assert.ok(result[0].description.includes('long enough'));
  });

  it('handles multi-line continuation bullets', () => {
    const body = `
## Breaking Changes

### core

- First line of a long breaking change
  that continues on the next line
  and a third line.
- A separate short but valid change here.
`.trim();
    const result = parseAngularReleaseBody(body, 20, '2026-lts');
    // Both bullets should be captured
    assert.equal(result.length, 2);
    // The first should have all three lines joined
    assert.ok(result[0].description.includes('First line'));
    assert.ok(result[0].description.includes('continues on the next line'));
    assert.ok(result[0].description.includes('and a third line'));
  });

  it('trims the title at the first sentence boundary', () => {
    const body = `
## Breaking Changes

### core

- Short first sentence. Followed by a long explanation that should not appear in the title.
`.trim();
    const result = parseAngularReleaseBody(body, 20, '2026-lts');
    assert.equal(result.length, 1);
    const title = result[0].title;
    // Title should end after the first sentence
    assert.ok(title.endsWith('Short first sentence.'), `title was: ${title}`);
  });

  it('normalises CRLF line endings', () => {
    const body = ANGULAR19_FIXTURE.replace(/\n/g, '\r\n');
    const result = parseAngularReleaseBody(body, 19, '2026-lts');
    assert.ok(result.length > 0, 'CRLF body should still produce results');
  });

  it('correctly attributes changes to the passed introducedIn alias', () => {
    const result = parseAngularReleaseBody(ANGULAR20_FIXTURE, 20, '2027-lts');
    for (const change of result) {
      assert.equal(change.introducedIn, '2027-lts');
    }
  });
});

// ─── Unit tests: fetchAngularBreakingChanges edge cases ───────────────────────

describe('fetchAngularBreakingChanges — same/downgrade versions', () => {
  it('returns [] when fromMajor === toMajor', async () => {
    const result = await fetchAngularBreakingChanges(20, 20, '2026-lts');
    assert.deepEqual(result, []);
  });

  it('returns [] when fromMajor > toMajor (downgrade guard)', async () => {
    const result = await fetchAngularBreakingChanges(21, 20, '2026-lts');
    assert.deepEqual(result, []);
  });
});

// ─── Integration tests: live Angular GitHub releases ─────────────────────────
//
// These tests hit the real GitHub API.  They are intentionally kept narrow:
// verify the fetch succeeds and returns a non-empty set of well-formed changes
// for releases we know exist (Angular 19, 20) and that missing releases (Angular 21,
// which has not been tagged yet as of the test date) return [] without throwing.

describe('fetchAngularBreakingChanges — live network', { timeout: 30_000 }, () => {
  it('fetches Angular 19 breaking changes (19.0.0 tag must exist)', async () => {
    const result = await fetchAngularBreakingChanges(18, 19, '2026-lts');
    assert.ok(result.length > 0, 'expected > 0 breaking changes from Angular 19');
    for (const change of result) {
      assert.equal(change.category, 'angular');
      assert.equal(change.severity, 'BREAKING');
      assert.equal(change.introducedIn, '2026-lts');
      assert.ok(change.sourceUrl?.endsWith('tag/19.0.0'), `bad sourceUrl: ${change.sourceUrl}`);
    }
  });

  it('fetches Angular 20 breaking changes (20.0.0 tag must exist)', async () => {
    const result = await fetchAngularBreakingChanges(19, 20, '2026-lts');
    assert.ok(result.length > 0, 'expected > 0 breaking changes from Angular 20');
    for (const change of result) {
      assert.equal(change.category, 'angular');
      assert.equal(change.severity, 'BREAKING');
      assert.ok(change.sourceUrl?.endsWith('tag/20.0.0'), `bad sourceUrl: ${change.sourceUrl}`);
    }
  });

  it('fetches both Angular 19 and 20 in a single call (range 18→20)', async () => {
    const result = await fetchAngularBreakingChanges(18, 20, '2026-lts');
    const v19 = result.filter((c) => c.sourceUrl?.endsWith('tag/19.0.0'));
    const v20 = result.filter((c) => c.sourceUrl?.endsWith('tag/20.0.0'));
    assert.ok(v19.length > 0, 'expected Angular 19 changes in range 18→20');
    assert.ok(v20.length > 0, 'expected Angular 20 changes in range 18→20');
  });

  it('returns [] for Angular 21 without throwing (tag not yet published)', async () => {
    // Angular 21.0.0 has not been released as of the current date.
    // The fetcher must return an empty array gracefully (HTTP 404 → null → []).
    const result = await fetchAngularBreakingChanges(20, 21, '2027-lts');
    assert.ok(Array.isArray(result), 'result must be an array');
    // When Angular 21 ships, this will contain results; until then it must be empty.
    for (const change of result) {
      // If it ever has results they must still be well-formed
      assert.equal(change.category, 'angular');
      assert.equal(change.severity, 'BREAKING');
    }
  });
});
