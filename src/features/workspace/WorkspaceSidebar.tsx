import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { sessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import {
  relatedParentSessionPaths,
  sidebarSessionTree,
  workspaceActivityPreview,
  workspaceSidebarEntries,
  workspaceSessionCounts,
  type PinnedSession,
  type SessionActionTarget,
  type SidebarSessionNode,
} from './sidebar-sessions.ts'
import { SessionRenameDialog } from './SessionRenameDialog.tsx'
import { maxWorkspaceSidebarWidth, minWorkspaceSidebarWidth } from './workspace-sidebar.ts'
import { urlForSession } from './session-url.ts'

interface ContextMenuState {
  target: SessionActionTarget
  x: number
  y: number
}

type WorkspaceActivityItem =
  | { kind: 'managed'; session: SessionSummary; pinned: boolean }
  | { kind: 'pinned'; session: PinnedSession }

interface WorkspaceSidebarProps {
  collapsed: boolean
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  isRefreshing: boolean
  pinnedSessions: readonly PinnedSession[]
  recentSessions: RecentSession[]
  recentWorkspacePaths: string[]
  sentSessions: RecentSession[]
  sessions: SessionSummary[]
  selectedId: string
  width: number
  workspacePath: string
  onChooseWorkspace: () => void
  onSelectWorkspace: (path: string) => void
  onCloseSession: (sessionId: string) => Promise<void>
  onCreate: () => Promise<void>
  onOpenSession: (session: RecentSession) => Promise<void>
  onOpenOtherWorkspaceSession: (session: PinnedSession) => Promise<void>
  onSelectOtherWorkspaceSession: (session: SessionSummary) => void
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
  onRenameSession: (target: SessionActionTarget, name: string) => Promise<void>
  onTogglePinnedSession: (target: SessionActionTarget) => void
  onResize: (width: number) => void
  onToggleCollapsed: () => void
  onError: (cause: unknown) => void
}

/** Displays the current workspace and opens or selects its recent Pi sessions. */
export function WorkspaceSidebar({
  collapsed,
  compactingSessionIds,
  completedSessionIds,
  isRefreshing,
  pinnedSessions,
  recentSessions,
  recentWorkspacePaths,
  sentSessions,
  sessions,
  selectedId,
  width,
  workspacePath,
  onChooseWorkspace,
  onSelectWorkspace,
  onCloseSession,
  onCreate,
  onOpenSession,
  onOpenOtherWorkspaceSession,
  onSelectOtherWorkspaceSession,
  onSelectSession,
  onOpenSettings,
  onRenameSession,
  onTogglePinnedSession,
  onResize,
  onToggleCollapsed,
  onError,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const [expandedSessionPaths, setExpandedSessionPaths] = useState<ReadonlySet<string>>(new Set())
  const [expandedWorkspacePaths, setExpandedWorkspacePaths] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [renameTarget, setRenameTarget] = useState<SessionActionTarget | null>(null)
  const selectedSessionRef = useRef<HTMLAnchorElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null)
  const pinnedSessionPaths = useMemo(
    () => new Set(pinnedSessions.map((session) => session.sessionPath)),
    [pinnedSessions],
  )
  const activeSessionPaths = useMemo(
    () =>
      new Set(
        sessions.flatMap((session) =>
          session.status !== 'exited' && session.sessionPath ? [session.sessionPath] : []
        ),
      ),
    [sessions],
  )
  const sessionTree = useMemo(
    () =>
      sidebarSessionTree(
        recentSessions,
        workspacePath,
        sentSessions,
        activeSessionPaths,
      ),
    [activeSessionPaths, recentSessions, sentSessions, workspacePath],
  )
  const workspaceEntries = useMemo(
    () =>
      workspaceSidebarEntries(
        workspacePath,
        recentWorkspacePaths,
        sessions,
        compactingSessionIds,
        completedSessionIds,
        pinnedSessions,
      ),
    [
      compactingSessionIds,
      completedSessionIds,
      pinnedSessions,
      recentWorkspacePaths,
      sessions,
      workspacePath,
    ],
  )
  const currentWorkspaceName = workspaceEntries
    .find((entry) => entry.path === workspacePath)
    ?.displayName ?? workspacePath

  useEffect(() => {
    selectedSessionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, sessionTree])

  useEffect(() => {
    const selectedPath = sessions.find((session) => session.id === selectedId)?.sessionPath
    if (!selectedPath) return
    const parentPaths = relatedParentSessionPaths(
      [...recentSessions, ...sentSessions],
      selectedPath,
    )
    if (parentPaths.length === 0) return
    setExpandedSessionPaths((current) => {
      const next = new Set(current)
      for (const path of parentPaths) next.add(path)
      return next.size === current.size ? current : next
    })
  }, [recentSessions, selectedId, sentSessions, sessions])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const { width: menuWidth, height: menuHeight } = contextMenuRef.current.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, contextMenu.x),
      Math.max(8, window.innerWidth - menuWidth - 8),
    )
    const top = Math.min(
      Math.max(8, contextMenu.y),
      Math.max(8, window.innerHeight - menuHeight - 8),
    )
    setContextMenuPosition({ left, top })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !contextMenuRef.current?.contains(event.target)) {
        setContextMenu(null)
      }
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setContextMenu(null)
      contextMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [contextMenu])

  function dismissContextMenu(): void {
    setContextMenu(null)
    contextMenuTriggerRef.current?.focus()
  }

  function openContextMenu(
    target: SessionActionTarget,
    event: ReactMouseEvent<HTMLButtonElement | HTMLAnchorElement>,
  ): void {
    event.preventDefault()
    contextMenuTriggerRef.current = event.currentTarget
    setContextMenu({ target, x: event.clientX, y: event.clientY })
  }

  function openContextMenuFromKeyboard(
    target: SessionActionTarget,
    event: ReactKeyboardEvent<HTMLButtonElement | HTMLAnchorElement>,
  ): void {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    contextMenuTriggerRef.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({ target, x: rect.left, y: rect.bottom })
  }

  function startRename(): void {
    if (!contextMenu) return
    const { target } = contextMenu
    dismissContextMenu()
    setRenameTarget(target)
  }

  function dismissRename(): void {
    setRenameTarget(null)
    contextMenuTriggerRef.current?.focus()
  }

  function togglePin(): void {
    const target = contextMenu?.target
    if (!target?.sessionPath) return
    dismissContextMenu()
    onTogglePinnedSession(target)
  }

  async function closeTarget(): Promise<void> {
    const sessionId = contextMenu?.target.sessionId
    dismissContextMenu()
    if (!sessionId) return
    try {
      await onCloseSession(sessionId)
    } catch (cause) {
      onError(cause)
    }
  }

  function openPinnedSession(session: PinnedSession): void {
    setOpeningSessionPath(session.sessionPath)
    void onOpenOtherWorkspaceSession(session).catch(onError).finally(() =>
      setOpeningSessionPath((current) => current === session.sessionPath ? '' : current)
    )
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + moveEvent.clientX - initialX)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minWorkspaceSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxWorkspaceSidebarWidth)
    }
  }

  /** Renders one related-session branch while retaining the existing row actions. */
  function renderSessionNode(node: SidebarSessionNode) {
    const { session: recentSession } = node
    const activeSession = sessions.find((session) =>
      session.sessionPath === recentSession.sessionPath && session.status !== 'exited'
    )
    const managedIndicator = sessionIndicator(
      activeSession,
      selectedId,
      compactingSessionIds,
      completedSessionIds,
    )
    const agentIndicator = recentSession.agentStatus === 'running'
      ? 'working'
      : recentSession.agentStatus === 'finished'
      ? 'complete'
      : null
    const indicator = managedIndicator ?? agentIndicator
    const indicatorClass = managedIndicator ?? (agentIndicator === 'working' ? 'working' : null)
    const indicatorLabel = managedIndicator
      ? undefined
      : agentIndicator === 'working'
      ? 'Delegated agent is running'
      : agentIndicator === 'complete'
      ? 'Delegated agent finished'
      : undefined
    const isPinned = pinnedSessionPaths.has(recentSession.sessionPath)
    const isExpanded = expandedSessionPaths.has(recentSession.sessionPath)
    const displayName = recentSession.displayName ?? recentSession.name
    const sessionLabel = openingSessionPath === recentSession.sessionPath
      ? 'Opening…'
      : displayName
    const actionTarget: SessionActionTarget = {
      cwd: recentSession.cwd,
      name: recentSession.name,
      sessionId: activeSession?.id,
      sessionPath: recentSession.sessionPath,
    }
    return (
      <div className='session-tree-node' key={recentSession.sessionPath}>
        <div className='session-tree-row'>
          {node.children.length > 0
            ? (
              <button
                aria-expanded={isExpanded}
                aria-label={`${
                  isExpanded ? 'Collapse' : 'Expand'
                } ${node.children.length} related ${
                  node.children.length === 1 ? 'session' : 'sessions'
                } for ${displayName}`}
                className={`session-tree-toggle${isExpanded ? ' expanded' : ''}`}
                onClick={() =>
                  setExpandedSessionPaths((current) => {
                    const next = new Set(current)
                    if (next.has(recentSession.sessionPath)) next.delete(recentSession.sessionPath)
                    else next.add(recentSession.sessionPath)
                    return next
                  })}
                type='button'
              >
                <ChevronIcon />
                <span>{node.children.length}</span>
              </button>
            )
            : <span aria-hidden='true' className='session-tree-spacer' />}
          <Tooltip
            hint='Right-click to pin, rename, or close the session'
            label={`${displayName}\n${
              new Date(recentSession.updatedAt).toLocaleString('en-US', { hourCycle: 'h23' })
            }`}
          >
            <a
              aria-disabled={openingSessionPath === recentSession.sessionPath || undefined}
              aria-haspopup='menu'
              className={`session-item${activeSession?.id === selectedId ? ' selected' : ''}${
                indicatorClass ? ` ${indicatorClass}` : ''
              }${isPinned ? ' pinned' : ''}`}
              href={urlForSession(activeSession?.id ?? recentSession.id)}
              onContextMenu={(event) => openContextMenu(actionTarget, event)}
              onKeyDown={(event) => openContextMenuFromKeyboard(actionTarget, event)}
              onClick={(event) => {
                event.preventDefault()
                if (openingSessionPath === recentSession.sessionPath) return
                if (activeSession) {
                  onSelectSession(activeSession.id)
                  return
                }
                setOpeningSessionPath(recentSession.sessionPath)
                void onOpenSession(recentSession).catch(onError).finally(() =>
                  setOpeningSessionPath('')
                )
              }}
              ref={activeSession?.id === selectedId ? selectedSessionRef : undefined}
            >
              {indicator && <SessionStatusIndicator label={indicatorLabel} status={indicator} />}
              {isPinned && <PinIcon />}
              <span>
                <strong>{sessionLabel}</strong>
              </span>
            </a>
          </Tooltip>
        </div>
        {isExpanded && node.children.length > 0 && (
          <div className='session-tree-children'>
            {node.children.map(renderSessionNode)}
          </div>
        )}
      </div>
    )
  }

  /** Renders one bounded background-session preview with the same session actions as the main list. */
  function renderWorkspaceActivityItem(item: WorkspaceActivityItem) {
    const session = item.session
    const isManaged = item.kind === 'managed'
    const linkedSessionId = item.kind === 'managed'
      ? item.session.id
      : sessions.find((candidate) => candidate.sessionPath === session.sessionPath)?.id
    const indicator = item.kind === 'managed'
      ? sessionIndicator(item.session, selectedId, compactingSessionIds, completedSessionIds)
      : null
    const isPinned = item.kind === 'pinned' || item.pinned
    const actionTarget: SessionActionTarget = {
      cwd: session.cwd,
      name: session.name,
      sessionId: item.kind === 'managed' ? item.session.id : undefined,
      sessionPath: session.sessionPath,
    }
    const label = `${session.name} in workspace ${session.cwd}${isPinned ? ', pinned' : ''}`
    return (
      <Tooltip
        hint={`Right-click to ${
          isPinned ? 'unpin, rename, or close' : 'pin, rename, or close'
        } the session`}
        key={item.kind === 'managed' ? item.session.id : item.session.sessionPath}
        label={`${session.name}\n${session.cwd}`}
      >
        <a
          aria-disabled={!isManaged && openingSessionPath === session.sessionPath
            ? true
            : undefined}
          aria-haspopup='menu'
          aria-label={label}
          className={`session-item workspace-activity-session${indicator ? ` ${indicator}` : ''}${
            isPinned ? ' pinned' : ''
          }`}
          href={urlForSession(linkedSessionId ?? '')}
          onContextMenu={(event) => openContextMenu(actionTarget, event)}
          onKeyDown={(event) => openContextMenuFromKeyboard(actionTarget, event)}
          onClick={(event) => {
            event.preventDefault()
            if (!isManaged && openingSessionPath === session.sessionPath) return
            if (item.kind === 'managed') onSelectOtherWorkspaceSession(item.session)
            else openPinnedSession(item.session)
          }}
        >
          {indicator && <SessionStatusIndicator status={indicator} />}
          {isPinned && <PinIcon />}
          <span>
            <strong>{session.name}</strong>
            <small>{session.cwd}</small>
          </span>
        </a>
      </Tooltip>
    )
  }

  const contextMenuSessionPath = contextMenu?.target.sessionPath
  const contextMenuIsPinned = contextMenuSessionPath !== undefined
    && pinnedSessionPaths.has(contextMenuSessionPath)

  return (
    <aside
      aria-label='Session sidebar'
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
    >
      <div className='sidebar-rail'>
        <Tooltip label='Expand session sidebar'>
          <button
            aria-expanded={false}
            aria-label='Expand session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon collapsed />
          </button>
        </Tooltip>
      </div>
      <div
        aria-label='Resize session sidebar'
        aria-orientation='vertical'
        aria-valuemax={maxWorkspaceSidebarWidth}
        aria-valuemin={minWorkspaceSidebarWidth}
        aria-valuenow={width}
        className='sidebar-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <div className='brand'>
        <span className='brand-mark'>π</span>
        <div>
          <strong>Pi Livecraft</strong>
          <small>Local workspace</small>
        </div>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='settings-button'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
        <Tooltip label='Collapse session sidebar'>
          <button
            aria-expanded={true}
            aria-label='Collapse session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <SidebarToggleIcon collapsed={false} />
          </button>
        </Tooltip>
      </div>
      <section
        aria-labelledby='workspace-switcher-title'
        className='workspace-switcher'
      >
        <div className='workspace-section-header'>
          <h2 id='workspace-switcher-title'>Workspaces</h2>
          <Tooltip label='Choose a workspace directory'>
            <button
              aria-label='Choose a workspace directory'
              className='workspace-choose'
              onClick={onChooseWorkspace}
              type='button'
            >
              <WorkspaceIcon />
              <span>Choose</span>
            </button>
          </Tooltip>
        </div>
        <nav aria-label='Workspaces' className='workspace-list'>
          {workspaceEntries.map((entry, index) => {
            const isActive = entry.path === workspacePath
            const activityItems: WorkspaceActivityItem[] = [
              ...entry.sessions.map((session) => ({
                kind: 'managed' as const,
                pinned: session.sessionPath !== undefined
                  && pinnedSessionPaths.has(session.sessionPath),
                session,
              })),
              ...entry
                .pinnedSessions
                .filter((session) =>
                  !entry.sessions.some(
                    (managed) => managed.sessionPath === session.sessionPath,
                  )
                )
                .map((session) => ({ kind: 'pinned' as const, session })),
            ]
            const isExpanded = expandedWorkspacePaths.has(entry.path)
            const activityPreview = workspaceActivityPreview(activityItems, isExpanded)
            const counts = workspaceSessionCounts(sessions, entry.path, completedSessionIds)
            const activityId = `workspace-activity-${index}`
            return (
              <div
                className={`workspace-entry${isActive ? ' active' : ''}`}
                key={entry.path}
              >
                <div className='workspace-row'>
                  <Tooltip label={entry.path} hint='Select workspace'>
                    <button
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={`Open workspace ${entry.path}${isActive ? ', Active' : ''}`}
                      className='workspace-item'
                      onClick={() => onSelectWorkspace(entry.path)}
                      title={entry.path}
                      type='button'
                    >
                      <WorkspaceIcon />
                      <span className='workspace-item-copy'>
                        <span className='workspace-item-heading'>
                          <strong>{entry.displayName}</strong>
                          {isActive && <span className='workspace-active-label'>Active</span>}
                        </span>
                        <small title={entry.path}>{entry.path}</small>
                      </span>
                      <span
                        aria-label='Session status counts'
                        className='workspace-status-counts'
                      >
                        {counts.running > 0 && (
                          <span className='workspace-status-count running'>
                            <SessionStatusIndicator label='Running sessions' status='working' />
                            {counts.running}
                          </span>
                        )}
                        {counts.waiting > 0 && (
                          <span className='workspace-status-count waiting'>
                            <SessionStatusIndicator
                              label='Sessions waiting for a response'
                              status='waiting'
                            />
                            {counts.waiting}
                          </span>
                        )}
                        {counts.unread > 0 && (
                          <span className='workspace-status-count unread'>
                            <SessionStatusIndicator
                              label='Finished unread sessions'
                              status='complete'
                            />
                            {counts.unread}
                          </span>
                        )}
                      </span>
                    </button>
                  </Tooltip>
                  {activityPreview.hasMore && (
                    <button
                      aria-controls={activityId}
                      aria-expanded={isExpanded}
                      aria-label={`${
                        isExpanded ? 'Show less' : 'Show all'
                      } activity for ${entry.displayName}`}
                      className={`workspace-activity-toggle${isExpanded ? ' expanded' : ''}`}
                      onClick={() =>
                        setExpandedWorkspacePaths((current) => {
                          const next = new Set(current)
                          if (next.has(entry.path)) next.delete(entry.path)
                          else next.add(entry.path)
                          return next
                        })}
                      type='button'
                    >
                      <ChevronIcon />
                      <span>{isExpanded ? 'Show less' : 'Show all'}</span>
                    </button>
                  )}
                </div>
                {activityItems.length > 0 && (
                  <div className='workspace-activity' id={activityId}>
                    <div
                      aria-label={`Activity in workspace ${entry.path}`}
                      className='workspace-activity-list'
                    >
                      {activityPreview.visible.map(renderWorkspaceActivityItem)}
                    </div>
                    {activityPreview.hasMore && !isExpanded && (
                      <p className='workspace-activity-more'>
                        {activityItems.length - activityPreview.visible.length}{' '}
                        more session{activityItems.length - activityPreview.visible.length === 1
                          ? ''
                          : 's'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </section>
      <section aria-labelledby='current-sessions-title' className='session-section'>
        <div className='session-section-header'>
          <h2 id='current-sessions-title'>Sessions · {currentWorkspaceName}</h2>
          <NewSessionButton compact onCreate={onCreate} onError={onError} />
        </div>
        <nav className='session-list' aria-label={`Recent Pi sessions in ${workspacePath}`}>
          {isRefreshing && sessionTree.length === 0 && (
            <p className='session-list-loading' role='status'>Loading sessions…</p>
          )}
          {sessionTree.map(renderSessionNode)}
          {sessionTree.length === 0 && !isRefreshing && (
            <p className='empty-sidebar'>No Pi sessions in this directory.</p>
          )}
        </nav>
      </section>
      {contextMenu && (
        <div
          aria-label='Session actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          {contextMenuSessionPath && (
            <button autoFocus onClick={togglePin} role='menuitem' type='button'>
              {contextMenuIsPinned ? 'Unpin session' : 'Pin session'}
            </button>
          )}
          <button
            autoFocus={!contextMenuSessionPath}
            onClick={startRename}
            role='menuitem'
            type='button'
          >
            Rename…
          </button>
          {contextMenu.target.sessionId && (
            <button
              className='danger'
              onClick={() => void closeTarget()}
              role='menuitem'
              type='button'
            >
              Close session
            </button>
          )}
        </div>
      )}
      {renameTarget && (
        <SessionRenameDialog
          initialName={renameTarget.name}
          key={renameTarget.sessionPath ?? renameTarget.sessionId ?? renameTarget.name}
          onClose={dismissRename}
          onConfirm={(name) => onRenameSession(renameTarget, name)}
        />
      )}
    </aside>
  )
}

/** Prevents duplicate session creation and reports errors to the container. */
function NewSessionButton(
  {
    compact = false,
    onCreate,
    onError,
  }: {
    compact?: boolean
    onCreate: () => Promise<void>
    onError: (cause: unknown) => void
  },
) {
  const [busy, setBusy] = useState(false)

  async function create(): Promise<void> {
    setBusy(true)
    try {
      await onCreate()
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      aria-busy={busy}
      aria-label={busy ? 'Starting a new session' : 'Start a new session'}
      className={`new-session${compact ? ' compact' : ''}`}
      disabled={busy}
      onClick={() => void create()}
      type='button'
    >
      {busy ? 'Starting…' : '＋ New session'}
    </button>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3 3v18' />
      <path d={collapsed ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
    </svg>
  )
}

function WorkspaceIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8A1.5 1.5 0 0 1 20.5 8.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z' />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='m9 6 6 6-6 6' />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='m9 3 6 6' />
      <path d='m5 8 11 11' />
      <path d='m14 4 6 6-4 1-4 4-1 4-6-6 4-1 4-4 1-4Z' />
      <path d='m12 16-5 5' />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
      <path d='m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a2 2 0 1 1-4 0v-.2a1.9 1.9 0 0 0-3.2-1.3l.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.9 1.9 0 0 0 2.2 12a1.9 1.9 0 0 0 1.2-3.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.9 1.9 0 0 0 3.2-1.3v-.2a2 2 0 1 1 4 0v.2a1.9 1.9 0 0 0 3.2 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.9 1.9 0 0 0 20.8 12a1.9 1.9 0 0 0-1.4 3Z' />
    </svg>
  )
}
