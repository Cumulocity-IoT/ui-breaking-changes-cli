/**
 * Type definitions for breaking change data.
 *
 * All actual data is fetched at runtime by scraping:
 *  - https://cumulocity.com/docs/{year}/change-logs/ (WebSDK changes)
 *  - https://cumulocity.com/docs/change-logs/        (REST API changes)
 *
 * See src/fetchers/c8y-changelog-fetcher.ts for the fetch + parse logic.
 */

export type Severity = 'BREAKING' | 'NOTABLE' | 'INFO';
export type Category = 'angular' | 'websdk-ui' | 'rest-api' | 'migration' | 'security';

export interface BreakingChange {
  /** LTS alias this change was introduced in; absent for REST API entries */
  introducedIn?: string;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  /** Specific action the developer must take; may be absent for informational entries */
  actionRequired?: string;
  /** Optional grep hints for finding affected code */
  grepHints?: string[];
  sourceUrl?: string;
  /** Version string from the technicalcomponent-ui-c8y button, e.g. "1023.0.0" */
  uiVersion?: string;
}
