import type { SessionSnapshot } from '../../../shared/types.ts'

/** Preserves relay-child history when its process briefly reports an empty snapshot. */
export function mergeCachedRelayEvents(
  cachedSnapshot: SessionSnapshot | undefined,
  nextSnapshot: SessionSnapshot,
  isRelaySession: boolean,
): SessionSnapshot {
  if (
    !isRelaySession || !cachedSnapshot || cachedSnapshot.liveEvents.length === 0
    || nextSnapshot.liveEvents.length > 0
  ) return nextSnapshot
  return { ...nextSnapshot, liveEvents: cachedSnapshot.liveEvents }
}
