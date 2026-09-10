import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'

export interface SessionActionTarget {
  cwd: string
  name: string
  sessionId?: string
  sessionPath?: string
}

export interface WorkspaceSessionCounts {
  running: number
  unread: number
}

/** Counts active and finished-unread sessions belonging to one workspace. */
export function workspaceSessionCounts(
  sessions: readonly SessionSummary[],
  workspacePath: string,
  completedSessionIds: ReadonlySet<string>,
): WorkspaceSessionCounts {
  return sessions
    .filter((session) => session.cwd === workspacePath)
    .reduce(
      (counts, session) => ({
        running: counts.running + Number(session.status === 'running'),
        unread: counts.unread + Number(
          completedSessionIds.has(session.sessionPath ?? session.id)
        ),
      }),
      { running: 0, unread: 0 },
    )
}

export type PinnedSession = Pick<RecentSession, 'cwd' | 'name' | 'sessionPath'>

export interface SidebarSessionNode {
  session: RecentSession
  children: SidebarSessionNode[]
}

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

/** Groups child sessions beneath their persisted parent without relying on generated names. */
export function sidebarSessionTree(
  recentSessions: RecentSession[],
  workspacePath: string,
  sentSessions: RecentSession[] = [],
  activeSessionPaths: ReadonlySet<string> = new Set(),
): SidebarSessionNode[] {
  const visible = sidebarSessions(recentSessions, workspacePath, sentSessions)
  const nodesByPath = new Map<string, SidebarSessionNode>(
    visible.map((session) => [session.sessionPath, { session, children: [] }]),
  )
  const roots: SidebarSessionNode[] = []
  for (const node of nodesByPath.values()) {
    const parentPath = node.session.parentSessionPath
    const parent = parentPath && !wouldCreateSessionCycle(node.session, parentPath, nodesByPath)
      ? nodesByPath.get(parentPath)
      : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const latestActivity = (node: SidebarSessionNode): number =>
    Math.max(node.session.updatedAt, ...node.children.map(latestActivity))
  const hasActiveSession = (node: SidebarSessionNode): boolean =>
    activeSessionPaths.has(node.session.sessionPath) || node.children.some(hasActiveSession)
  const sortByActivity = (nodes: SidebarSessionNode[]): void => {
    nodes.sort((left, right) => {
      const activeOrder = Number(hasActiveSession(right)) - Number(hasActiveSession(left))
      return activeOrder || latestActivity(right) - latestActivity(left)
    })
    for (const node of nodes) sortByActivity(node.children)
  }
  sortByActivity(roots)
  return roots
}

/** Prevents malformed parent links from creating an unrenderable recursive tree. */
function wouldCreateSessionCycle(
  session: RecentSession,
  parentPath: string,
  nodesByPath: ReadonlyMap<string, SidebarSessionNode>,
): boolean {
  const visited = new Set([session.sessionPath])
  let path: string | undefined = parentPath
  while (path) {
    if (visited.has(path)) return true
    visited.add(path)
    path = nodesByPath.get(path)?.session.parentSessionPath
  }
  return false
}

/** Lists every available parent path that must expand to reveal a selected child. */
export function relatedParentSessionPaths(
  sessions: readonly RecentSession[],
  selectedSessionPath: string,
): string[] {
  const byPath = new Map(sessions.map((session) => [session.sessionPath, session]))
  const parentPaths: string[] = []
  const visited = new Set<string>()
  let parentPath = byPath.get(selectedSessionPath)?.parentSessionPath
  while (parentPath && !visited.has(parentPath)) {
    visited.add(parentPath)
    parentPaths.push(parentPath)
    parentPath = byPath.get(parentPath)?.parentSessionPath
  }
  return parentPaths
}

/** Finds the persisted child associated with an Agent result identifier. */
export function relatedAgentSession(
  sessions: readonly RecentSession[],
  parentSessionPath: string,
  agentId: string,
): RecentSession | undefined {
  const shortId = agentId.match(/^[0-9a-f]{8}/)?.[0]
  if (!shortId) return undefined
  return sessions.find((session) =>
    session.parentSessionPath === parentSessionPath && session.name.endsWith(`#${shortId}`)
  )
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
