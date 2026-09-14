import { useEffect, useMemo, useState } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import type { LiveMessage } from './message-reconciliation.ts'
import type { ToolExecution } from './tool-protocol.ts'
import type { SubagentBridgeSnapshot } from './subagent-bridge.ts'
import { urlForSession } from '../workspace/session-url.ts'
import {
  projectSubagentMonitor,
  formatAgentTokens,
  formatSubagentDuration,
  formatSubagentModelConfig,
  type SubagentMonitorRow,
} from './subagent-monitor.ts'

interface SubagentMonitorProps {
  bridgeSnapshot?: SubagentBridgeSnapshot
  liveMessages: readonly LiveMessage[]
  messages: readonly JsonObject[]
  onError: (cause: unknown) => void
  onOpenAgentSession: (agentId: string) => Promise<void>
  agentSessionIdForAgent: (agentId: string) => string | undefined
  toolExecutions: readonly ToolExecution[]
}

/** Shows parent-session Agent runs and opens their persisted live or terminal transcript. */
export function SubagentMonitor({
  bridgeSnapshot,
  liveMessages,
  messages,
  onError,
  onOpenAgentSession,
  agentSessionIdForAgent,
  toolExecutions,
}: SubagentMonitorProps) {
  const hasRunningBridgeAgent = bridgeSnapshot?.agents.some(({ status }) => status === 'running')
    ?? false
  const now = useSubagentMonitorClock(hasRunningBridgeAgent)
  const view = useMemo(
    () =>
      projectSubagentMonitor(
        [...messages, ...liveMessages.map(({ message }) => message)],
        toolExecutions,
        bridgeSnapshot,
        now,
      ),
    [bridgeSnapshot, liveMessages, messages, now, toolExecutions],
  )
  if (view.active.length === 0 && view.history.length === 0) return null

  return (
    <section aria-label='Subagent monitor' className='subagent-monitor'>
      <div className='subagent-monitor-heading'>
        <strong>Subagents</strong>
        {view.active.length > 0 && (
          <span aria-live='polite' className='subagent-monitor-active-count'>
            {view
              .active
              .length} running
          </span>
        )}
      </div>
      {view.active.length > 0 && (
        <div aria-label='Active subagents' className='subagent-monitor-active'>
          {view
            .active
            .map((row) => (
              <SubagentRow
                key={row.agentId}
                onError={onError}
                row={row}
                onOpenAgentSession={onOpenAgentSession}
                agentSessionIdForAgent={agentSessionIdForAgent}
              />
            ))}
        </div>
      )}
      {view.history.length > 0 && (
        <details className='subagent-monitor-history'>
          <summary>History ({view.history.length})</summary>
          <div aria-label='Finished subagents' className='subagent-monitor-history-list'>
            {view.history.map((row) => (
              <SubagentRow
                compact
                key={row.agentId}
                onError={onError}
                row={row}
                onOpenAgentSession={onOpenAgentSession}
                agentSessionIdForAgent={agentSessionIdForAgent}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

/** Keeps bridge-backed running durations current without scheduling an idle timer. */
function useSubagentMonitorClock(hasRunningBridgeAgent: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!hasRunningBridgeAgent) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [hasRunningBridgeAgent])

  return now
}

function SubagentRow({
  compact = false,
  onError,
  onOpenAgentSession,
  agentSessionIdForAgent,
  row,
}: {
  compact?: boolean
  onError: (cause: unknown) => void
  onOpenAgentSession: (agentId: string) => Promise<void>
  agentSessionIdForAgent: (agentId: string) => string | undefined
  row: SubagentMonitorRow
}) {
  const typeLabel = row.subagentType ? ` (${row.subagentType})` : ''
  const running = row.status === 'running'
  const provisional = row.provisional === true
  const title = row.description ?? (provisional ? 'Starting subagent…' : row.agentId)
  const canOpen = !provisional
  const interactionLabel = provisional
    ? `Starting subagent ${title}${typeLabel}`
    : `${running ? 'Open live conversation' : 'Open transcript'} for subagent ${title}${typeLabel}`
  const modelConfig = formatSubagentModelConfig(row)
  const tokenFact = row.tokens === undefined ? undefined : formatAgentTokens(row.tokens)
  return (
    <a
      aria-disabled={!canOpen || undefined}
      aria-label={interactionLabel}
      className={`subagent-row${compact ? ' compact' : ''}`}
      href={canOpen
        ? urlForSession(agentSessionIdForAgent(row.agentId) ?? row.childSessionId ?? row.agentId)
        : undefined}
      onClick={(event) => {
        event.preventDefault()
        if (!canOpen) return
        void onOpenAgentSession(row.agentId).catch(onError)
      }}
      title={provisional
        ? interactionLabel
        : `${running ? 'Open live conversation' : 'Open transcript'} for ${title}${typeLabel}`}
    >
      <span
        aria-label={row.status ?? 'Status unavailable'}
        className={`subagent-status ${row.status ?? 'unknown'}`}
        title={row.status ?? 'Status unavailable'}
      >
        <i aria-hidden='true' />
        {row.status && <span className='subagent-status-label'>{row.status}</span>}
      </span>
      <span className='subagent-row-copy'>
        <span className='subagent-row-title'>
          <strong>{title}</strong>
        </span>
        {running && row.latestActivity && (
          <span
            aria-label={`Latest activity: ${row.latestActivity}`}
            className='subagent-row-latest-activity'
            title={row.latestActivity}
          >
            {row.latestActivity}
          </span>
        )}
      </span>
      <div className='subagent-row-facts'>
        {modelConfig && (
          <span
            aria-label={modelConfig.ariaLabel}
            className='subagent-row-model'
            title={modelConfig.ariaLabel}
          >
            {modelConfig.text}
          </span>
        )}
        {(row.durationMs !== undefined
          || row.turnCount !== undefined
          || row.toolCount !== undefined) && (
          <span className='subagent-row-activity'>
            {row.durationMs !== undefined && <span>{formatSubagentDuration(row.durationMs)}</span>}
            {row.turnCount !== undefined && (
              <span aria-label={`${row.turnCount} turns`} title={`${row.turnCount} turns`}>
                <span aria-hidden='true'>↻</span>{row.turnCount}
              </span>
            )}
            {row.toolCount !== undefined && (
              <span aria-label={`${row.toolCount} tool uses`} title={`${row.toolCount} tool uses`}>
                <span aria-hidden='true'>🪏</span> {row.toolCount}
              </span>
            )}
          </span>
        )}
        {tokenFact && (
          <span
            aria-label={tokenFact.ariaLabel}
            className='subagent-row-tokens'
            title={tokenFact.ariaLabel}
          >
            {typeof row.tokens === 'number'
              ? tokenFact.text
              : <span aria-hidden='true'>{tokenFact.text}</span>}
          </span>
        )}
      </div>
    </a>
  )
}
