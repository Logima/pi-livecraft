import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'

export interface SessionActionTarget {
  cwd: string
  name: string
  sessionId?: string
  sessionPath?: string
}

export type PinnedSession = Pick<RecentSession, 'cwd' | 'name' | 'sessionPath'>

/** Adds pending sessions and orders the visible list by latest activity. */
export function sidebarSessions(
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
): RecentSession[] {
  const recentIds = new Set(recentSessions.map((session) => session.id))
  const recentPaths = new Set(recentSessions.map((session) => session.sessionPath))
  const pending = sentSessions.filter((session) =>
    !recentIds.has(session.id) && !recentPaths.has(session.sessionPath)
  )
  return [...pending, ...recentSessions]
    .filter(({ cwd }) => cwd === workspacePath)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Picks the next visible active session after closing the selected one. */
export function nextActiveSessionId(
  closedSessionId: string,
  sessions: SessionSummary[],
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
): string | null {
  const activeIds = sidebarSessions(recentSessions, workspacePath, sentSessions).flatMap(
    (recent) => {
      const active = sessions.find((session) =>
        session.sessionPath === recent.sessionPath && session.status !== 'exited'
      )
      return active ? [active.id] : []
    },
  )
  const closedIndex = activeIds.indexOf(closedSessionId)
  return closedIndex >= 0
    ? activeIds[closedIndex + 1] ?? activeIds[closedIndex - 1] ?? null
    : activeIds[0] ?? null
}

/** Lists attention-worthy sessions outside the current workspace, with active work first. */
export function otherWorkspaceSessions(
  sessions: SessionSummary[],
  workspacePath: string,
  compactingSessionIds: ReadonlySet<string>,
  completedSessionIds: ReadonlySet<string>,
  pinnedSessionPaths: ReadonlySet<string> = new Set(),
): SessionSummary[] {
  const relevant = sessions.flatMap((session) => {
    if (session.cwd === workspacePath || session.status === 'exited') return []
    const indicator = sessionIndicator(session, '', compactingSessionIds, completedSessionIds)
    const pinned = session.sessionPath !== undefined && pinnedSessionPaths.has(session.sessionPath)
    return pinned || (indicator !== null && indicator !== 'idle') ? [{ session, indicator }] : []
  })
  return [
    ...relevant.filter(({ indicator }) => indicator !== 'idle' && indicator !== 'complete'),
    ...relevant.filter(({ indicator }) => indicator === 'idle'),
    ...relevant.filter(({ indicator }) => indicator === 'complete'),
  ]
    .map(({ session }) => session)
}

/** Lists pinned session files outside the current workspace without active manager duplicates. */
export function otherWorkspacePinnedSessions(
  pinnedSessions: readonly PinnedSession[],
  sessions: SessionSummary[],
  workspacePath: string,
): PinnedSession[] {
  const activePaths = new Set(
    sessions.flatMap((session) =>
      session.status !== 'exited' && session.sessionPath ? [session.sessionPath] : []
    ),
  )
  return pinnedSessions.filter((session) =>
    session.cwd !== workspacePath && !activePaths.has(session.sessionPath)
  )
}

/**
 * Picks the session to auto-select when opening a workspace.
 * Priority: most recent completed unviewed session → most recent active session → none.
 */
export function pickSessionOnOpen(
  visibleSessions: RecentSession[],
  activeSessions: SessionSummary[],
  completedSessionIds: ReadonlySet<string>,
): string | null {
  for (const visible of visibleSessions) {
    const active = activeSessions.find(
      (s) => s.sessionPath === visible.sessionPath && s.status !== 'exited',
    )
    if (active && active.status === 'idle' && completedSessionIds.has(visible.sessionPath)) {
      return active.id
    }
  }
  for (const visible of visibleSessions) {
    const active = activeSessions.find(
      (s) => s.sessionPath === visible.sessionPath && s.status !== 'exited',
    )
    if (active && (active.status === 'starting' || active.status === 'running')) {
      return active.id
    }
  }
  return null
}
