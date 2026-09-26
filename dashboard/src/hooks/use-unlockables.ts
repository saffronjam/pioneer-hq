import { useMemo } from 'react';
import { useContextSelector } from 'use-context-selector';
import { ApiContext } from 'src/contexts/api/useApi';
import { LOCKABLE_FEATURES, LockableFeature } from 'src/config/unlockables';

/**
 * Result of checking if a feature is locked.
 */
export interface LockStatus {
  /** Whether the feature is locked (false = unlocked/accessible) */
  isLocked: boolean;
  /** Lock configuration for display if locked, undefined if unlocked */
  lockInfo?: LockableFeature;
}

/**
 * Hook providing unlock status checking for lockable features.
 * Uses schematics data from GraphQL subscriptions to determine which milestones have been purchased.
 * Implements fail-open behavior: features are unlocked when schematics data is unavailable
 * or when a specific milestone is not found in the schematics data.
 */
export function useUnlockables() {
  const schematics = useContextSelector(ApiContext, (v) => v.schematics);

  const purchasedMilestones = useMemo(() => {
    if (!schematics || schematics.length === 0) {
      return new Set<string>();
    }
    return new Set(schematics.filter((s) => s.purchased).map((s) => s.name));
  }, [schematics]);

  const allMilestoneNames = useMemo(() => {
    if (!schematics || schematics.length === 0) {
      return new Set<string>();
    }
    return new Set(schematics.map((s) => s.name));
  }, [schematics]);

  const schematicsAvailable = schematics && schematics.length > 0;

  /**
   * Checks if a feature at the given route is locked.
   * Returns unlocked status if schematics data is unavailable or milestone not found (fail-open).
   */
  const isFeatureLocked = (route: string): boolean => {
    if (!schematicsAvailable) {
      return false;
    }

    const feature = LOCKABLE_FEATURES.find((f) => f.route === route);
    if (!feature) {
      return false;
    }

    if (!allMilestoneNames.has(feature.milestoneName)) {
      return false;
    }

    return !purchasedMilestones.has(feature.milestoneName);
  };

  /**
   * Gets the lock status for a feature at the given route.
   * Returns lock info for display in locked state UI.
   * Returns unlocked status if schematics data is unavailable or milestone not found (fail-open).
   */
  const getLockStatus = (route: string): LockStatus => {
    if (!schematicsAvailable) {
      return { isLocked: false };
    }

    const feature = LOCKABLE_FEATURES.find((f) => f.route === route);
    if (!feature) {
      return { isLocked: false };
    }

    if (!allMilestoneNames.has(feature.milestoneName)) {
      return { isLocked: false };
    }

    const isLocked = !purchasedMilestones.has(feature.milestoneName);
    return {
      isLocked,
      lockInfo: isLocked ? feature : undefined,
    };
  };

  /**
   * Gets lock status for all lockable features.
   * Useful for nav items that need to display lock state.
   */
  const getAllLockStatuses = (): Map<string, LockStatus> => {
    const statuses = new Map<string, LockStatus>();
    for (const feature of LOCKABLE_FEATURES) {
      statuses.set(feature.route, getLockStatus(feature.route));
    }
    return statuses;
  };

  return {
    isFeatureLocked,
    getLockStatus,
    getAllLockStatuses,
    schematicsAvailable,
  };
}
