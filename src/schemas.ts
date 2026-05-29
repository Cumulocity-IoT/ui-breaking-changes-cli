/**
 * Zod schemas for external API responses consumed by this CLI.
 *
 * All schemas use `.passthrough()` so that extra/unknown fields returned by
 * the APIs do not cause parse failures — only the fields we actually read
 * are validated.
 *
 * On a `safeParse` failure the caller should emit a stderr warning and fall
 * back gracefully (return null / empty array) rather than crashing.
 */

import { z } from 'zod';

// ─── GitHub Releases API ──────────────────────────────────────────────────────
// Endpoint: GET https://api.github.com/repos/angular/angular/releases/tags/{N}.0.0
// Docs: https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name

export const GitHubReleaseSchema = z
  .object({
    /** Git tag name, e.g. "20.0.0" */
    tag_name: z.string(),
    /** Full markdown release notes body */
    body: z.string().nullable().optional(),
  });

export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;

// ─── npm Registry Package Manifest ───────────────────────────────────────────
// Endpoint: GET https://registry.npmjs.org/@c8y/ngx-components  (abbreviated manifest)
// Docs: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md

export const NpmVersionMetaSchema = z.object({
  /** Peer-dependency ranges declared by this package version */
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

export type NpmVersionMeta = z.infer<typeof NpmVersionMetaSchema>;

export const NpmPackageManifestSchema = z.object({
  /** dist-tags map, e.g. `{ latest: "1023.14.145", "y2026-lts": "..." }` */
  'dist-tags': z.record(z.string(), z.string()),
  /** Per-version metadata map; may be omitted in abbreviated responses */
  versions: z.record(z.string(), NpmVersionMetaSchema).optional(),
  /**
   * ISO 8601 publish timestamps per version, e.g. `{ "1023.14.0": "2026-01-15T10:00:00.000Z" }`.
   * Also contains `"created"` and `"modified"` keys (non-version strings); these are filtered
   * out in the npm-fetcher when looking up release dates for stable lines.
   */
  time: z.record(z.string(), z.string()).optional(),
});

export type NpmPackageManifest = z.infer<typeof NpmPackageManifestSchema>;

// ─── npm registry — dist-tags-only (used by fetchLatestCdVersion) ─────────────

export const NpmDistTagsSchema = z.object({
  'dist-tags': z.record(z.string(), z.string()).optional(),
});

export type NpmDistTags = z.infer<typeof NpmDistTagsSchema>;

// ─── Cumulocity changelog page — scraped HTML output ─────────────────────────
// Source: https://cumulocity.com/docs/{year}/change-logs/
// These are structs constructed from HTML parsing. Validating them here catches
// regressions if the page HTML structure changes and our regex starts producing
// empty / malformed data.

/**
 * Validates the raw HTML of a Cumulocity changelog page.
 *
 * Checks for the structural markers we depend on before attempting to parse:
 *  - At least one `<section` tag with a `page-section` class
 *  - At least one date signal: either a `data-date` attribute or an `<h5>` element
 *    (the global `/docs/change-logs/` page uses `<h5>` headers; year pages use `data-date`)
 *
 * If either check fails the caller should emit a warning and return an empty array
 * rather than proceeding with a likely-broken parse.
 */
export const ChangelogHtmlSchema = z
  .string()
  .refine((html) => /class="[^"]*page-section/.test(html), {
    message: 'No <section class="...page-section..."> found — page structure may have changed',
  })
  .refine((html) => /data-date="|<h5[\s>]/.test(html), {
    message: 'No date signals (data-date attribute or <h5> header) found — page structure may have changed',
  });

/** Raw data extracted from one <section> block before further processing. */
export const C8yChangelogEntrySchema = z.object({
  /** Section anchor id, e.g. "ui-c8y-1021-0-0-dashboard-manager-as-separate-plugin" */
  id: z.string(),
  /** ISO-ish date string from data-date attribute, e.g. "2025-03-31 12:00:00 +0000 UTC" */
  date: z.string().min(1, 'date must not be empty — entry has no data-date and no preceding <h5> header'),
  /** Change type class extracted from section classes, e.g. "api-change" or "announcement" */
  changeType: z.string().min(1),
  /** Component slug extracted from section classes, e.g. "rest-api" or "web-sdk" */
  component: z.string().min(1),
  /** Change title from <h2> text (may be empty string when h2 contains only the copy-link button) */
  title: z.string(),
  /** Full description HTML extracted from the <p> tags inside change-log__summary */
  description: z.string(),
  /** Canonical URL of the source page with fragment appended */
  url: z.string().url(),
  /**
   * Version string from the `<button data-tag="technicalcomponent-ui-c8y">` metadata button,
   * e.g. "1021.0.0". Present only for Web SDK entries that carry this metadata.
   * When present, used as an additional range filter: the entry is included only when
   * uiVersion is strictly greater than fromVersion and at most toVersion.
   */
  uiVersion: z.string().optional(),
});

export type C8yChangelogEntry = z.infer<typeof C8yChangelogEntrySchema>;
