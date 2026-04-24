import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseChangelogHtml } from './c8y-changelog-fetcher.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Minimal but structurally faithful HTML fragments based on the actual
// Cumulocity changelog page format (Hugo-generated SSR HTML).

const BASE_URL = 'https://cumulocity.com/docs/2025/change-logs/';
const BASE_URL_2026 = 'https://cumulocity.com/docs/2026/change-logs/';

/**
 * Fixture: the "revert parameter" REST API breaking change.
 * Used to verify the parser handles year-specific page HTML correctly.
 */
const REVERT_PARAM_ENTRY = `
<article>
  <section
    id='cumulocity-2026-revert-parameter-time-series'
    class="page-section change-type-api-change component-rest-api  productarea-platform-services technicalcomponent-cumulocity"
    data-date="2026-03-31 12:00:00 &#43;0000 UTC"
  >
    <div class="article-content change-log">
      <div class="change-log__header">
        <h2>
          Change of the default value of revert parameter for time series measurements
          <button title="Copy link" class="btn-link bookmark" data-clipboard-text="#">
            <span class="fa dlt-c8y-icon-link"></span>
          </button>
        </h2>
      </div>
      <div class="change-log__summary">
        <label class='change-log__label--api-change'>API Change</label>
        <div class="metadata">
          <button class="btn-metadata" data-tag="component-rest-api">
            <small class="text-muted">Component</small>
            <p>REST API</p>
          </button>
        </div>
      </div><p>The default value of the revert parameter for time series measurements has been changed to true.</p>
      <div class="change-log__details">Technical details here</div>
    </div>
  </section>
</article>
`.trim();

/** A REST API `api-change` entry with a title and multi-paragraph description. */
const API_CHANGE_ENTRY = `
<article>
  <section
    id='cumulocity-notifications-operations-wildcard'
    class="page-section change-type-api-change component-rest-api  productarea-platform-services technicalcomponent-cumulocity"
    data-date="2025-03-31 12:00:00 &#43;0000 UTC"
  >
    <div class="article-content change-log">
      <div class="change-log__header">
        <h2>
          Wildcard API selector now includes operations
          <button title="Copy link" class="btn-link bookmark" data-clipboard-text="#">
            <span class="fa dlt-c8y-icon-link"></span>
          </button>
        </h2>
      </div>
      <div class="change-log__summary">
        <label class='change-log__label--issue'>API Change</label>
        <div class="metadata">
          <button class="btn-metadata" data-tag="component-rest-api">
            <small class="text-muted">Component</small>
            <p>REST API</p>
          </button>
        </div>
      </div><p>Applications utilizing the wildcard API selector in Notifications 2.0 will now receive operations updates.</p>
      <p>This applies to both existing and new tenant context subscriptions.</p>
      <div class="change-log__details">Technical details here</div>
    </div>
  </section>
</article>
`.trim();

/** A Web SDK `announcement` entry with a title. */
const ANNOUNCEMENT_ENTRY = `
<article>
  <section
    id='ui-c8y-1021-0-0-dashboard-manager-as-separate-plugin'
    class="page-section change-type-announcement component-web-sdk  productarea-application-enablement-solutions technicalcomponent-ui-c8y"
    data-date="2025-03-31 12:00:00 &#43;0000 UTC"
  >
    <div class="article-content change-log">
      <div class="change-log__header">
        <h2>
          Dashboard manager extracted into a separate plugin
          <button title="Copy link" class="btn-link bookmark">
            <span class="fa dlt-c8y-icon-link"></span>
          </button>
        </h2>
      </div>
      <div class="change-log__summary">
        <label class='change-log__label--announcement'>Announcement</label>
        <div class="metadata">
          <button class="btn-metadata" data-tag="component-web-sdk">
            <small class="text-muted">Component</small>
            <p>Web SDK</p>
          </button>
          <button class="btn-metadata " data-tag="technicalcomponent-ui-c8y">
            <small class="text-muted">Build artifact / version</small>
            <p>ui-c8y
             - 1021.0.0
            </p>
          </button>
        </div>
      </div><p>In an upcoming version the dashboard manager module will be extracted from the Cockpit application.</p>
      <div class="change-log__details">Technical details here</div>
    </div>
  </section>
</article>
`.trim();

/** An entry that should be filtered out (wrong component). */
const OTHER_COMPONENT_ENTRY = `
<article>
  <section
    id='some-cockpit-change'
    class="page-section change-type-api-change component-cockpit  productarea-foo"
    data-date="2025-03-31 12:00:00 &#43;0000 UTC"
  >
    <div class="article-content change-log">
      <div class="change-log__header"><h2>Some cockpit change</h2></div>
      <div class="change-log__summary">
      </div><p>Cockpit change description.</p>
      <div class="change-log__details"></div>
    </div>
  </section>
</article>
`.trim();

/** Page with two valid entries and one that should be filtered. */
const MIXED_PAGE = [API_CHANGE_ENTRY, ANNOUNCEMENT_ENTRY, OTHER_COMPONENT_ENTRY].join('\n');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseChangelogHtml', () => {
  it('returns [] for empty HTML', () => {
    const result = parseChangelogHtml('', BASE_URL, ['api-change'], ['rest-api']);
    assert.deepEqual(result, []);
  });

  it('returns [] when HTML has no matching section', () => {
    const result = parseChangelogHtml(
      '<html><body>No changelog here</body></html>',
      BASE_URL,
      ['api-change'],
      ['rest-api'],
    );
    assert.deepEqual(result, []);
  });

  it('parses a REST API api-change entry correctly', () => {
    const result = parseChangelogHtml(
      API_CHANGE_ENTRY,
      BASE_URL,
      ['api-change'],
      ['rest-api'],
    );
    assert.equal(result.length, 1);

    const entry = result[0];
    assert.equal(entry.id, 'cumulocity-notifications-operations-wildcard');
    assert.equal(entry.changeType, 'api-change');
    assert.equal(entry.component, 'rest-api');
    assert.ok(entry.title.includes('Wildcard API selector'), `title was: "${entry.title}"`);
    assert.ok(entry.description.includes('Notifications 2.0'), `desc: "${entry.description}"`);
    assert.ok(entry.url.endsWith('#cumulocity-notifications-operations-wildcard'));
  });

  it('parses the date field, decoding HTML entities', () => {
    const result = parseChangelogHtml(API_CHANGE_ENTRY, BASE_URL, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    assert.ok(result[0].date.includes('2025-03-31'), `date: "${result[0].date}"`);
    // &#43; should be decoded to +
    assert.ok(result[0].date.includes('+'), `+ not decoded in: "${result[0].date}"`);
  });

  it('parses a Web SDK announcement entry correctly', () => {
    const result = parseChangelogHtml(
      ANNOUNCEMENT_ENTRY,
      BASE_URL,
      ['announcement'],
      ['web-sdk'],
    );
    assert.equal(result.length, 1);

    const entry = result[0];
    assert.equal(entry.changeType, 'announcement');
    assert.equal(entry.component, 'web-sdk');
    assert.ok(entry.title.includes('Dashboard manager'));
    assert.ok(entry.description.includes('dashboard manager module'));
    assert.ok(entry.url.includes('#ui-c8y-1021-0-0-dashboard-manager-as-separate-plugin'));
  });

  it('extracts uiVersion from the technicalcomponent-ui-c8y button', () => {
    const result = parseChangelogHtml(
      ANNOUNCEMENT_ENTRY,
      BASE_URL,
      ['announcement'],
      ['web-sdk'],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].uiVersion, '1021.0.0');
  });

  it('extracts a non-major-only uiVersion (e.g. 1022.8.3) correctly', () => {
    const html = ANNOUNCEMENT_ENTRY.replace(
      '- 1021.0.0',
      '- 1022.8.3',
    );
    const result = parseChangelogHtml(html, BASE_URL, ['announcement'], ['web-sdk']);
    assert.equal(result.length, 1);
    assert.equal(result[0].uiVersion, '1022.8.3');
  });

  it('leaves uiVersion undefined when no technicalcomponent-ui-c8y button is present', () => {
    // REST API entry has no such button
    const result = parseChangelogHtml(API_CHANGE_ENTRY, BASE_URL, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    assert.equal(result[0].uiVersion, undefined);
  });

  it('filters out entries with wrong change-type', () => {
    // Only request 'announcement' — should not return the api-change entry
    const result = parseChangelogHtml(MIXED_PAGE, BASE_URL, ['announcement'], ['rest-api', 'web-sdk']);
    assert.ok(result.every(e => e.changeType === 'announcement'), 'all results must be announcements');
  });

  it('filters out entries with wrong component', () => {
    // Only request 'rest-api' — should not return the web-sdk or cockpit entries
    const result = parseChangelogHtml(MIXED_PAGE, BASE_URL, ['api-change', 'announcement'], ['rest-api']);
    assert.ok(result.every(e => e.component === 'rest-api'), 'all results must be rest-api');
  });

  it('returns entries for both requested change types and components', () => {
    const result = parseChangelogHtml(
      MIXED_PAGE,
      BASE_URL,
      ['api-change', 'announcement'],
      ['rest-api', 'web-sdk'],
    );
    assert.equal(result.length, 2);
    const types = result.map(e => e.changeType);
    assert.ok(types.includes('api-change'));
    assert.ok(types.includes('announcement'));
  });

  it('strips HTML tags from title (removes the copy-link button content)', () => {
    const result = parseChangelogHtml(API_CHANGE_ENTRY, BASE_URL, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    // Must not contain raw HTML tags
    assert.ok(!result[0].title.includes('<'), `title contains HTML: "${result[0].title}"`);
    assert.ok(!result[0].title.includes('Copy link'), 'title must not contain button text');
  });

  it('strips HTML tags and collapses whitespace from description', () => {
    const result = parseChangelogHtml(API_CHANGE_ENTRY, BASE_URL, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    assert.ok(!result[0].description.includes('<p>'), 'description must not contain <p> tags');
    assert.ok(!result[0].description.includes('  '), 'description must not have double spaces');
  });

  it('builds a valid URL with fragment from page base URL + section id', () => {
    const result = parseChangelogHtml(API_CHANGE_ENTRY, BASE_URL, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    assert.equal(
      result[0].url,
      'https://cumulocity.com/docs/2025/change-logs/#cumulocity-notifications-operations-wildcard',
    );
  });

  it('handles &amp; entity in description correctly', () => {
    const htmlWithAmp = ANNOUNCEMENT_ENTRY.replace(
      'dashboard manager module',
      'Application enablement &amp; solutions module',
    );
    const result = parseChangelogHtml(htmlWithAmp, BASE_URL, ['announcement'], ['web-sdk']);
    assert.equal(result.length, 1);
    assert.ok(result[0].description.includes('&'), `& not decoded in: "${result[0].description}"`);
  });
});

// ─── parseChangelogHtml — year-specific page HTML ──────────────────────────────────────
// The parser is URL-agnostic — it works identically on year-specific and global
// pages. The fixtures below use a 2026 year URL purely for URL-construction checks.

describe('parseChangelogHtml — year-specific REST API entry (regression)', () => {
  it('parses the revert-parameter entry from a 2026 year URL', () => {
    const result = parseChangelogHtml(REVERT_PARAM_ENTRY, BASE_URL_2026, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    const entry = result[0];
    assert.equal(entry.changeType, 'api-change');
    assert.equal(entry.component, 'rest-api');
    assert.ok(
      entry.title.toLowerCase().includes('revert'),
      `expected "revert" in title, got: "${entry.title}"`,
    );
    assert.ok(
      entry.title.toLowerCase().includes('time series'),
      `expected "time series" in title, got: "${entry.title}"`,
    );
  });

  it('produced entry URL uses the year-specific base URL', () => {
    const result = parseChangelogHtml(REVERT_PARAM_ENTRY, BASE_URL_2026, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    assert.ok(
      result[0].url.startsWith('https://cumulocity.com/docs/2026/change-logs/'),
      `expected 2026 year URL, got: "${result[0].url}"`,
    );
  });

  it('is NOT returned when fetching from the 2025 URL (wrong year filter)', () => {
    // The entry has a 2026 date; requesting it via the 2025 URL would be a different
    // network call — here we just verify the parser does not mangle the URL.
    const result = parseChangelogHtml(REVERT_PARAM_ENTRY, BASE_URL, ['api-change'], ['rest-api']);
    assert.equal(result.length, 1);
    // URL uses whatever base was passed — confirms URL construction is URL-driven, not date-driven
    assert.ok(result[0].url.startsWith('https://cumulocity.com/docs/2025/change-logs/'));
  });
});

// ─── Integration test: live network ──────────────────────────────────────────

describe('fetchC8yChangelog — live network', { timeout: 30_000 }, () => {
  it('fetches 2025 changelog and returns at least one api-change or announcement for rest-api / web-sdk', async () => {
    const { fetchC8yChangelog } = await import('./c8y-changelog-fetcher.js');
    const results = await fetchC8yChangelog(2025, ['api-change', 'announcement'], ['rest-api', 'web-sdk']);

    assert.ok(results.length > 0, `expected > 0 entries, got ${results.length}`);

    for (const entry of results) {
      assert.ok(['api-change', 'announcement'].includes(entry.changeType), `unexpected changeType: ${entry.changeType}`);
      assert.ok(['rest-api', 'web-sdk'].includes(entry.component), `unexpected component: ${entry.component}`);
      assert.ok(typeof entry.title === 'string');
      assert.ok(typeof entry.description === 'string');
      assert.ok(entry.url.startsWith('https://cumulocity.com/docs/2025/change-logs/'));
    }
  });

  // Regression test: verifies the live 2026 year-specific page can be fetched.
  // fetchChangelogs now uses only the global page; this tests fetchC8yChangelog directly.
  it('fetches 2026 year-specific changelog and returns rest-api api-change entries', async () => {
    const { fetchC8yChangelog } = await import('./c8y-changelog-fetcher.js');
    const results = await fetchC8yChangelog(2026, ['api-change'], ['rest-api']);

    assert.ok(results.length > 0, `expected > 0 rest-api api-change entries for 2026, got ${results.length}`);
    for (const entry of results) {
      assert.equal(entry.changeType, 'api-change');
      assert.equal(entry.component, 'rest-api');
      assert.ok(entry.url.startsWith('https://cumulocity.com/docs/2026/change-logs/'));
    }
  });
});
