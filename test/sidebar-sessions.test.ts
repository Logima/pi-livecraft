import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import {
  otherWorkspacePinnedSessions,
  otherWorkspaceSessions,
  pickSessionOnOpen,
  relatedAgentSession,
  relatedParentSessionPaths,
  sidebarSessions,
  sidebarSessionTree,
  workspaceActivityPreview,
  workspaceBasename,
  workspaceDisplayName,
  workspaceSidebarEntries,
  workspaceSessionCounts,
} from '../src/features/workspace/sidebar-sessions.ts'

const persisted: RecentSession = {
  id: 'persisted-id',
  cwd: '/workspace',
  name: 'Premier message',
  sessionPath: '/sessions/new.jsonl',
  updatedAt: 456,
}

test('shows persisted sessions from the current workspace', () => {
  assert.deepEqual(sidebarSessions([persisted], '/workspace'), [persisted])
})

test('counts running and unread sessions for a workspace without delegated agents', () => {
  const sessions: SessionSummary[] = [
    { id: 'running', cwd: '/workspace', name: 'Running', status: 'running', pendingUi: [] },
    {
      id: 'agent-running',
      cwd: '/workspace',
      name: 'Agent transcript',
      sessionPath: '/sessions/agent.jsonl',
      status: 'running',
      pendingUi: [],
      subagentRelation: {
        parentManagerSessionId: 'running',
        agentId: 'agent-id',
        childSessionId: 'agent-child',
      },
    },
    {
      id: 'finished',
      cwd: '/workspace',
      name: 'Finished',
      sessionPath: '/sessions/finished.jsonl',
      status: 'idle',
      pendingUi: [],
    },
    { id: 'waiting', cwd: '/workspace', name: 'Waiting', status: 'running', pendingUi: [{ method: 'confirm' }] },
    { id: 'other', cwd: '/other', name: 'Other', status: 'running', pendingUi: [] },
  ]

  assert.deepEqual(
    workspaceSessionCounts(
      sessions,
      '/workspace',
      new Set(['/sessions/finished.jsonl', '/sessions/agent.jsonl']),
    ),
    { running: 1, waiting: 1, unread: 1 },
  )
})

test('hides persisted sessions from another workspace', () => {
  assert.deepEqual(sidebarSessions([persisted], '/another-workspace'), [])
})

test('keeps a sent session visible when persistence temporarily omits it', () => {
  assert.deepEqual(sidebarSessions([], '/workspace', [persisted]), [persisted])
})

test('excludes subagent sessions even when metadata is unavailable', () => {
  const subagent = {
    ...persisted,
    name: 'common-agent#abcdf',
    sessionPath: '/sessions/subagent-fallback.jsonl',
    parentSessionPath: persisted.sessionPath,
  }

  assert.deepEqual(sidebarSessions([subagent], '/workspace'), [])
})

test('excludes subagent sessions but keeps other child sessions', () => {
  const subagent = {
    ...persisted,
    id: 'subagent-id',
    name: 'Explore#2b38211f',
    sessionPath: '/sessions/subagent.jsonl',
    parentSessionPath: persisted.sessionPath,
    agentStatus: 'finished' as const,
  }
  const userChild = {
    ...persisted,
    id: 'user-child-id',
    name: 'User-created fork',
    sessionPath: '/sessions/user-child.jsonl',
    parentSessionPath: persisted.sessionPath,
  }

  assert.deepEqual(sidebarSessions([subagent, userChild, persisted], '/workspace'), [
    userChild,
    persisted,
  ])
})

test('uses persisted order once the sent session is returned', () => {
  const other = {
    ...persisted,
    id: 'other-id',
    sessionPath: '/sessions/other.jsonl',
    updatedAt: 999,
  }
  const refreshed = { ...persisted, name: 'Generated title', updatedAt: 789 }

  assert.deepEqual(sidebarSessions([other, refreshed], '/workspace', [persisted]), [
    other,
    refreshed,
  ])
})

test('orders sessions by their latest activity', () => {
  const older = { ...persisted, updatedAt: 100 }
  const newer = {
    ...persisted,
    id: 'newer-id',
    sessionPath: '/sessions/newer.jsonl',
    updatedAt: 200,
  }

  assert.deepEqual(sidebarSessions([older, newer], '/workspace'), [newer, older])
})

test('groups arbitrarily named child sessions beneath their parent', () => {
  const olderRoot = { ...persisted, updatedAt: 100 }
  const child = {
    ...persisted,
    id: 'child-id',
    name: 'Explore#2b38211f',
    sessionPath: '/sessions/child.jsonl',
    parentSessionPath: persisted.sessionPath,
    updatedAt: 300,
  }
  const newerRoot = {
    ...persisted,
    id: 'newer-root',
    sessionPath: '/sessions/newer-root.jsonl',
    updatedAt: 200,
  }

  assert.deepEqual(sidebarSessionTree([olderRoot, child, newerRoot], '/workspace'), [
    { session: olderRoot, children: [{ session: child, children: [] }] },
    { session: newerRoot, children: [] },
  ])
})

test('puts active sessions before inactive sessions', () => {
  const inactive = { ...persisted, updatedAt: 900 }
  const active = {
    ...persisted,
    id: 'active-id',
    sessionPath: '/sessions/active.jsonl',
    updatedAt: 100,
  }

  assert.deepEqual(
    sidebarSessionTree([inactive, active], '/workspace', [], new Set([active.sessionPath])),
    [
      { session: active, children: [] },
      { session: inactive, children: [] },
    ],
  )
})

test('keeps a child with an unavailable parent visible as a root session', () => {
  const child = {
    ...persisted,
    parentSessionPath: '/sessions/another-workspace.jsonl',
  }

  assert.deepEqual(sidebarSessionTree([child], '/workspace'), [
    { session: child, children: [] },
  ])
})

test('does not expand parent branches for a subagent child', () => {
  const parent = { ...persisted, sessionPath: '/sessions/parent.jsonl' }
  const child = {
    ...persisted,
    name: 'common-agent#abcdf',
    sessionPath: '/sessions/child.jsonl',
    parentSessionPath: parent.sessionPath,
  }

  assert.deepEqual(relatedParentSessionPaths([parent, child], child.sessionPath), [])
})

test('lists the parent branches needed to reveal a selected child', () => {
  const parent = { ...persisted, sessionPath: '/sessions/parent.jsonl' }
  const child = {
    ...persisted,
    sessionPath: '/sessions/child.jsonl',
    parentSessionPath: parent.sessionPath,
  }
  const grandchild = {
    ...persisted,
    sessionPath: '/sessions/grandchild.jsonl',
    parentSessionPath: child.sessionPath,
  }

  assert.deepEqual(relatedParentSessionPaths([parent, child, grandchild], grandchild.sessionPath), [
    child.sessionPath,
    parent.sessionPath,
  ])
})

test('finds a related child from a full Agent result identifier', () => {
  const child = {
    ...persisted,
    name: 'Explore#2b38211f',
    parentSessionPath: '/sessions/parent.jsonl',
  }

  assert.equal(
    relatedAgentSession([child], '/sessions/parent.jsonl', '2b38211f-1234-567'),
    child,
  )
  assert.equal(relatedAgentSession([child], '/sessions/other.jsonl', '2b38211f'), undefined)
  assert.equal(relatedAgentSession([child], '/sessions/parent.jsonl', 'invalid'), undefined)
})

// -- otherWorkspaceSessions ------------------------------------------------

const remoteSession: SessionSummary = {
  id: 'remote-1',
  cwd: '/remote',
  name: 'Remote session',
  sessionPath: '/sessions/remote.jsonl',
  status: 'running',
  pendingUi: [],
}

test('shows active and unviewed completed sessions from other workspaces, active first', () => {
  const completed = {
    ...remoteSession,
    id: 'completed',
    sessionPath: '/sessions/completed.jsonl',
    status: 'idle' as const,
  }
  const starting = {
    ...remoteSession,
    id: 'starting',
    sessionPath: '/sessions/starting.jsonl',
    status: 'starting' as const,
  }

  assert.deepEqual(
    otherWorkspaceSessions(
      [completed, starting],
      '/workspace',
      new Set(),
      new Set(['/sessions/completed.jsonl']),
    ),
    [starting, completed],
  )
})

test('projects each workspace once in deterministic order with background activity', () => {
  const unread: SessionSummary = {
    id: 'unread',
    cwd: '/activity/unread',
    name: 'Unread',
    sessionPath: '/sessions/unread.jsonl',
    status: 'idle',
    pendingUi: [],
  }
  const running: SessionSummary = {
    id: 'running',
    cwd: '/activity/running',
    name: 'Running',
    sessionPath: '/sessions/running.jsonl',
    status: 'running',
    pendingUi: [],
  }
  const pinned = {
    cwd: '/activity/pinned',
    name: 'Pinned',
    sessionPath: '/sessions/pinned.jsonl',
  }
  const activePinned = {
    cwd: '/activity/running',
    name: 'Pinned running',
    sessionPath: '/sessions/running.jsonl',
  }

  const entries = workspaceSidebarEntries(
    '/current/workspace',
    ['/recent/workspace', '/activity/unread', '/recent/workspace'],
    [unread, running],
    new Set(),
    new Set(['/sessions/unread.jsonl']),
    [pinned, activePinned],
  )

  assert.deepEqual(entries.map((entry) => entry.path), [
    '/activity/pinned',
    '/activity/running',
    '/activity/unread',
    '/current/workspace',
    '/recent/workspace',
  ])
  assert.equal(entries.filter((entry) => entry.path === '/recent/workspace').length, 1)
  assert.deepEqual(entries.find((entry) => entry.path === '/activity/pinned')?.pinnedSessions, [
    pinned,
  ])
  assert.deepEqual(entries.find((entry) => entry.path === '/activity/running')?.sessions, [running])
  assert.deepEqual(entries.find((entry) => entry.path === '/activity/running')?.pinnedSessions, [])
})

test('formats workspace basenames and duplicate names across path conventions', () => {
  assert.equal(workspaceBasename('/home/dev/project/'), 'project')
  assert.equal(workspaceBasename('C:\\Users\\dev\\project\\'), 'project')
  assert.equal(workspaceBasename('~/project'), 'project')
  assert.equal(
    workspaceDisplayName('/one/project', ['/one/project', '/two/project']),
    'project · /one',
  )
  assert.equal(workspaceDisplayName('/one/unique', ['/one/unique']), 'unique')
})

test('bounds background activity previews without discarding the remainder', () => {
  const items = ['running', 'unread', 'pinned', 'older']
  assert.deepEqual(workspaceActivityPreview(items, false), {
    visible: ['running', 'unread', 'pinned'],
    hasMore: true,
  })
  assert.deepEqual(workspaceActivityPreview(items, true), {
    visible: items,
    hasMore: true,
  })
})

test('hides current, idle viewed, and exited sessions from other workspaces', () => {
  const current = { ...remoteSession, cwd: '/workspace' }
  const idle = { ...remoteSession, id: 'idle', status: 'idle' as const }
  const exited = { ...remoteSession, id: 'exited', status: 'exited' as const }

  assert.deepEqual(
    otherWorkspaceSessions([current, idle, exited], '/workspace', new Set(), new Set()),
    [],
  )
})

test('shows a pinned idle session after active work in another workspace', () => {
  const pinned = {
    ...remoteSession,
    id: 'pinned',
    sessionPath: '/sessions/pinned.jsonl',
    status: 'idle' as const,
  }

  assert.deepEqual(
    otherWorkspaceSessions(
      [pinned, remoteSession],
      '/workspace',
      new Set(),
      new Set(),
      new Set([pinned.sessionPath]),
    ),
    [remoteSession, pinned],
  )
})

test('keeps pinned history out of the active list and current workspace', () => {
  const active = {
    ...remoteSession,
    id: 'active',
    sessionPath: '/sessions/active.jsonl',
    status: 'idle' as const,
  }
  const historical = {
    cwd: '/remote',
    name: 'Historical session',
    sessionPath: '/sessions/historical.jsonl',
  }
  const current = {
    cwd: '/workspace',
    name: 'Current session',
    sessionPath: '/sessions/current.jsonl',
  }

  assert.deepEqual(
    otherWorkspacePinnedSessions([active, historical, current], [active], '/workspace'),
    [historical],
  )
})

// -- pickSessionOnOpen ------------------------------------------------------

const runningSession: SessionSummary = {
  id: 'active-1',
  cwd: '/workspace',
  name: 'Running session',
  sessionPath: '/sessions/active.jsonl',
  status: 'running',
  pendingUi: [],
}

const idleCompletedSession: SessionSummary = {
  id: 'idle-1',
  cwd: '/workspace',
  name: 'Idle completed',
  sessionPath: '/sessions/idle.jsonl',
  status: 'idle',
  pendingUi: [],
}

const startingSession: SessionSummary = {
  id: 'starting-1',
  cwd: '/workspace',
  name: 'Starting session',
  sessionPath: '/sessions/starting.jsonl',
  status: 'starting',
  pendingUi: [],
}

const exitedSession: SessionSummary = {
  id: 'exited-1',
  cwd: '/workspace',
  name: 'Exited session',
  sessionPath: '/sessions/exited.jsonl',
  status: 'exited',
  pendingUi: [],
}

const visibleCompleted: RecentSession = {
  id: 'idle-1',
  cwd: '/workspace',
  name: 'Idle completed',
  sessionPath: '/sessions/idle.jsonl',
  updatedAt: 200,
}

const visibleRunning: RecentSession = {
  id: 'active-1',
  cwd: '/workspace',
  name: 'Running session',
  sessionPath: '/sessions/active.jsonl',
  updatedAt: 300,
}

const visibleStarting: RecentSession = {
  id: 'starting-1',
  cwd: '/workspace',
  name: 'Starting session',
  sessionPath: '/sessions/starting.jsonl',
  updatedAt: 100,
}

test('pickSessionOnOpen returns the most recent completed unviewed session first', () => {
  const visible = [visibleRunning, visibleCompleted]
  const active = [runningSession, idleCompletedSession]
  const completed = new Set(['/sessions/idle.jsonl'])

  assert.equal(pickSessionOnOpen(visible, active, completed), 'idle-1')
})

test('pickSessionOnOpen falls back to the most recent active session when no completed unviewed', () => {
  const visible = [visibleStarting, visibleRunning]
  const active = [startingSession, runningSession]
  const completed = new Set<string>()

  assert.equal(pickSessionOnOpen(visible, active, completed), 'starting-1')
})

test('pickSessionOnOpen skips idle sessions not flagged as completed', () => {
  const visible = [visibleCompleted]
  const active = [idleCompletedSession]
  const completed = new Set<string>()

  assert.equal(pickSessionOnOpen(visible, active, completed), null)
})

test('pickSessionOnOpen skips exited sessions', () => {
  const visibleExited: RecentSession = {
    ...visibleCompleted,
    sessionPath: '/sessions/exited.jsonl',
  }
  const visible = [visibleExited]
  const active = [exitedSession]
  const completed = new Set(['/sessions/exited.jsonl'])

  assert.equal(pickSessionOnOpen(visible, active, completed), null)
})

test('pickSessionOnOpen returns null when no candidate exists', () => {
  assert.equal(pickSessionOnOpen([], [], new Set()), null)
})

test('pickSessionOnOpen picks a starting session as active', () => {
  const visible = [visibleStarting]
  const active = [startingSession]

  assert.equal(pickSessionOnOpen(visible, active, new Set()), 'starting-1')
})
