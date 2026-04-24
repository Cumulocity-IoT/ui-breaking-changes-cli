/**
 * Type definitions for breaking change data.
 *
 * All actual data is fetched at runtime from:
 *  - https://github.com/Cumulocity-IoT/cumulocity-skills/blob/main/skills/websdk-breaking-changelog/SKILL.md
 *  - https://github.com/Cumulocity-IoT/cumulocity-skills/blob/main/skills/c8y-client-breaking-changelog/SKILL.md
 *
 * See src/fetchers/github-skills-fetcher.ts for the fetch + parse logic.
 */

export type Severity = 'BREAKING' | 'NOTABLE' | 'INFO';
export type Category = 'angular' | 'websdk-ui' | 'rest-api' | 'migration' | 'security';

export interface BreakingChange {
  /** LTS alias this change was introduced in */
  introducedIn: string;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  actionRequired: string;
  /** Optional grep hints for finding affected code */
  grepHints?: string[];
  sourceUrl?: string;
}

export interface MigrationStep {
  order: number;
  title: string;
  description?: string;
  commands?: string[];
}

export interface VersionMigration {
  fromLine: string;
  toLine: string;
  steps: MigrationStep[];
  referenceUrl: string;
}
