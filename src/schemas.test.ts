import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubReleaseSchema,
  NpmPackageManifestSchema,
  NpmDistTagsSchema,
} from './schemas.js';

// ─── GitHubReleaseSchema ──────────────────────────────────────────────────────

describe('GitHubReleaseSchema', () => {
  it('accepts a well-formed release with a body', () => {
    const result = GitHubReleaseSchema.safeParse({
      tag_name: '20.0.0',
      body: '## Breaking Changes\n\n### core\n\n- Some change.',
      id: 12345,
      author: { login: 'angular-bot' },
    });
    assert.ok(result.success);
    assert.equal(result.data.tag_name, '20.0.0');
    assert.ok(result.data.body?.includes('Breaking Changes'));
  });

  it('accepts a release with a null body (body can be null on GitHub)', () => {
    const result = GitHubReleaseSchema.safeParse({
      tag_name: '20.0.0',
      body: null,
    });
    assert.ok(result.success);
    assert.equal(result.data.body, null);
  });

  it('accepts a release with body omitted entirely', () => {
    const result = GitHubReleaseSchema.safeParse({
      tag_name: '20.0.0',
    });
    assert.ok(result.success);
    assert.equal(result.data.body, undefined);
  });

  it('succeeds even when response contains unknown fields (API may add fields we do not read)', () => {
    const result = GitHubReleaseSchema.safeParse({
      tag_name: '19.0.0',
      body: 'notes',
      html_url: 'https://github.com/angular/angular/releases/tag/19.0.0',
      assets: [],
      published_at: '2025-01-01T00:00:00Z',
    });
    assert.ok(result.success);
    // known fields are accessible
    assert.equal(result.data.tag_name, '19.0.0');
    assert.equal(result.data.body, 'notes');
  });

  it('rejects a response missing tag_name (e.g. an error response or a different endpoint shape)', () => {
    const result = GitHubReleaseSchema.safeParse({
      message: 'Not Found',
    });
    assert.ok(!result.success, 'should fail when tag_name is absent');
  });

  it('rejects a response where body is not a string', () => {
    const result = GitHubReleaseSchema.safeParse({
      tag_name: '20.0.0',
      body: 42, // wrong type
    });
    assert.ok(!result.success, 'should fail when body is not a string');
  });

  it('rejects a non-object response', () => {
    const result = GitHubReleaseSchema.safeParse('Not Found');
    assert.ok(!result.success, 'should fail when response is a string');
  });
});

// ─── NpmPackageManifestSchema ─────────────────────────────────────────────────

describe('NpmPackageManifestSchema', () => {
  it('accepts a minimal valid manifest', () => {
    const result = NpmPackageManifestSchema.safeParse({
      'dist-tags': { latest: '1023.14.145' },
    });
    assert.ok(result.success);
    assert.equal(result.data['dist-tags'].latest, '1023.14.145');
  });

  it('accepts a manifest with multiple dist-tags and versions', () => {
    const result = NpmPackageManifestSchema.safeParse({
      'dist-tags': {
        latest: '1023.14.145',
        'y2026-lts': '1023.14.145',
        'y2025-lts': '1021.22.159',
      },
      versions: {
        '1023.14.145': {
          peerDependencies: {
            '@angular/core': '^20.0.0',
          },
        },
        '1021.22.159': {
          peerDependencies: {
            '@angular/core': '^18.2.11',
          },
        },
      },
    });
    assert.ok(result.success);
    assert.equal(
      result.data.versions?.['1023.14.145']?.peerDependencies?.['@angular/core'],
      '^20.0.0',
    );
  });

  it('accepts a manifest without the versions field (abbreviated response)', () => {
    const result = NpmPackageManifestSchema.safeParse({
      'dist-tags': { latest: '1023.14.145' },
    });
    assert.ok(result.success);
    assert.equal(result.data.versions, undefined);
  });

  it('accepts a version entry with no peerDependencies', () => {
    const result = NpmPackageManifestSchema.safeParse({
      'dist-tags': { latest: '1019.6.10' },
      versions: {
        '1019.6.10': {
          description: 'old package',
          // no peerDependencies — older packages may omit it
        },
      },
    });
    assert.ok(result.success);
    assert.equal(result.data.versions?.['1019.6.10']?.peerDependencies, undefined);
  });

  it('succeeds even when response contains top-level unknown fields', () => {
    const result = NpmPackageManifestSchema.safeParse({
      'dist-tags': { latest: '1023.14.145' },
      name: '@c8y/ngx-components',
      description: 'Angular modules for Cumulocity IoT applications',
      license: 'Apache-2.0',
    });
    assert.ok(result.success);
    assert.equal(result.data['dist-tags'].latest, '1023.14.145');
  });

  it('rejects a manifest missing dist-tags', () => {
    const result = NpmPackageManifestSchema.safeParse({
      versions: {},
    });
    assert.ok(!result.success, 'should fail when dist-tags is absent');
  });

  it('rejects a manifest where dist-tags contains a non-string value', () => {
    const result = NpmPackageManifestSchema.safeParse({
      'dist-tags': { latest: 12345 }, // wrong type
    });
    assert.ok(!result.success, 'should fail when a dist-tag value is not a string');
  });

  it('rejects a non-object response (e.g. registry returns an error string)', () => {
    const result = NpmPackageManifestSchema.safeParse('Registry error');
    assert.ok(!result.success, 'should fail for non-object responses');
  });
});

// ─── NpmDistTagsSchema ────────────────────────────────────────────────────────

describe('NpmDistTagsSchema', () => {
  it('accepts a response with dist-tags', () => {
    const result = NpmDistTagsSchema.safeParse({
      'dist-tags': { latest: '1023.14.145' },
    });
    assert.ok(result.success);
    assert.equal(result.data['dist-tags']?.latest, '1023.14.145');
  });

  it('accepts a response without dist-tags (field is optional)', () => {
    const result = NpmDistTagsSchema.safeParse({ name: '@c8y/ngx-components' });
    assert.ok(result.success);
    assert.equal(result.data['dist-tags'], undefined);
  });

  it('rejects a non-object response', () => {
    const result = NpmDistTagsSchema.safeParse(null);
    assert.ok(!result.success, 'should fail for null');
  });
});
