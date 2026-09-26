/**
 * Configuration for features that are locked until specific milestones are purchased.
 * Add new entries to LOCKABLE_FEATURES to lock additional navigation items/pages.
 *
 * @module unlockables
 */

/**
 * Defines a feature that requires a milestone to be unlocked.
 *
 * Features are automatically locked in navigation and on their respective pages
 * until the specified milestone is purchased in-game. The system uses GraphQL subscriptions
 * to update lock status in real-time.
 *
 * @example
 * ```typescript
 * // Adding a new lockable feature:
 * {
 *   route: '/vehicles',
 *   milestoneName: 'Automated Vehicles',
 *   tier: 4,
 *   displayName: 'Vehicles',
 * }
 * ```
 *
 * @property route - Must match the page route exactly (e.g., "/trains", "/drones").
 *   This is used to identify which navigation item and page to lock.
 * @property milestoneName - Must match the exact milestone name from the FRM API
 *   schematics data. Case-sensitive. If no match is found, the feature will be
 *   treated as unlocked.
 * @property tier - The milestone tier number for display purposes only. Shown on
 *   the locked page UI as "(Tier X)".
 * @property displayName - Human-readable name shown in the locked page UI and
 *   tooltips.
 */
export interface LockableFeature {
  /** Page route path that must match exactly (e.g., "/trains"). */
  route: string;
  /** Exact milestone name to match from schematics data. Case-sensitive. */
  milestoneName: string;
  /** Milestone tier number for display in locked state UI. */
  tier: number;
  /** Human-readable feature name for display in UI. */
  displayName: string;
}

/**
 * Static configuration defining which features require milestones to unlock.
 * Features are matched by route path and milestone name.
 */
export const LOCKABLE_FEATURES: LockableFeature[] = [
  {
    route: '/trains',
    milestoneName: 'Monorail Train Technology',
    tier: 6,
    displayName: 'Trains',
  },
  {
    route: '/drones',
    milestoneName: 'Aeronautical Engineering',
    tier: 8,
    displayName: 'Drones',
  },
];
