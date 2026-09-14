import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject, SubagentSessionRelation } from '../../../shared/types.ts'
import { formatTokens } from './message-usage.ts'
import type { SubagentBridgeAgent, SubagentBridgeSnapshot } from './subagent-bridge.ts'
import { bridgeAgentIdsByToolCallId } from './tool-call-agent.ts'
import {
  toolCallsInMessage,
  toolResultInMessage,
  type ToolExecution,
  type ToolResult,
} from './tool-protocol.ts'

export type SubagentLifecycle = 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled'

export interface RequestedModel {
  provider?: string
  modelId?: string
}

export interface AgentTokens {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

export interface SubagentMonitorRow {
  agentId: string
  /** Correlates a bridge row with the parent Agent ToolExecution. */
  toolCallId?: string
  description?: string
  subagentType?: string
  model?: string | RequestedModel
  thinking?: string
  effort?: string
  status?: SubagentLifecycle
  durationMs?: number
  toolCount?: number
  turnCount?: number
  tokens?: number | AgentTokens
  childSessionId?: string
  effectiveModel?: RequestedModel
  latestActivity?: string
  startedAt?: number
  completedAt?: number
  /** Marks a running Agent tool call before pi-subagents provides its real identity. */
  provisional?: boolean
}

export interface SubagentMonitorViewState {
  active: SubagentMonitorRow[]
  history: SubagentMonitorRow[]
}

/** Returns the browser-safe relation only while a bridge row owns live child work. */
export function subagentRelationForRow(
  parentManagerSessionId: string,
  row: Pick<SubagentMonitorRow, 'agentId' | 'childSessionId' | 'status'>,
): SubagentSessionRelation | undefined {
  if (row.status !== 'running' || row.childSessionId === undefined) return undefined
  return {
    parentManagerSessionId,
    agentId: row.agentId,
    childSessionId: row.childSessionId,
  }
}

/** Builds the private Pi command used to stop an ownership-checked child. */
export function subagentStopPrompt(agentId: string): string {
  return `/livecraft-stop-subagent ${agentId}`
}

interface SubagentFact {
  text: string
  ariaLabel: string
}

/** Formats a requested model ID without exposing its provider or raw separators. */
export function formatSubagentModel(model: string | RequestedModel): string | undefined {
  const modelId = typeof model === 'string' ? model : model.modelId
  if (!modelId) return undefined

  const modelSegments = modelId.split('/').filter(Boolean)
  const visibleId = modelSegments[modelSegments.length - 1] ?? modelId
  return visibleId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => {
      if (segment.toLowerCase() === 'gpt') return 'GPT'
      return `${segment[0].toUpperCase()}${segment.slice(1).toLowerCase()}`
    })
    .join(' ')
}

/** Formats elapsed monitor time using rounded whole seconds and compact units. */
export function formatSubagentDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}min`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

/** Combines the resolved or requested model, thinking, and distinct effort into one fact. */
export function formatSubagentModelConfig(
  row: Pick<SubagentMonitorRow, 'model' | 'effectiveModel' | 'thinking' | 'effort'>,
): SubagentFact | undefined {
  const resolvedModel = row.effectiveModel ?? row.model
  const model = resolvedModel === undefined ? undefined : formatSubagentModel(resolvedModel)
  const effort = row.effort !== undefined && row.effort !== row.thinking ? row.effort : undefined
  const text = [model, row.thinking, effort].filter(isPresent).join(' ')
  if (!text) return undefined

  const modelLabel = resolvedModel === undefined
    ? undefined
    : `${row.effectiveModel === undefined ? 'Requested model' : 'Model'} ${
      requestedModelText(
        resolvedModel,
      )
    }`
  return {
    ariaLabel: [
      modelLabel,
      row.thinking && `Requested thinking ${row.thinking}`,
      effort && `Requested effort ${effort}`,
    ]
      .filter(isPresent)
      .join(', '),
    text,
  }
}

/** Formats agent token telemetry, omitting cache counters from the dense row. */
export function formatAgentTokens(tokens: number | AgentTokens): SubagentFact | undefined {
  if (typeof tokens === 'number') {
    const total = formatTokens(tokens)
    return { ariaLabel: `Total ${total} tokens`, text: `${total} tokens` }
  }

  const input = tokens.input === undefined ? undefined : formatTokens(tokens.input)
  const output = tokens.output === undefined ? undefined : formatTokens(tokens.output)
  const visible = [input && `↘ ${input}`, output && `↗ ${output}`].filter(isPresent)
  if (visible.length === 0) return undefined

  return {
    ariaLabel: [
      input && `Input ${input} tokens`,
      output && `output ${output} tokens`,
    ]
      .filter(isPresent)
      .join(', '),
    text: visible.join(' · '),
  }
}

function requestedModelText(model: string | RequestedModel): string {
  if (typeof model === 'string') return model
  return [model.provider, model.modelId].filter(isPresent).join('/')
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0
}

/** Projects only parent-session Agent evidence into stable monitor rows. */
export function projectSubagentMonitor(
  messages: readonly JsonObject[],
  toolExecutions: readonly ToolExecution[] = [],
  bridgeSnapshot?: SubagentBridgeSnapshot,
  now = Date.now(),
): SubagentMonitorViewState {
  const rows = new Map<string, SubagentMonitorRow>()
  const callsById = new Map<string, { agentId?: string; args: unknown }>()
  const provisionalRows: string[] = []

  for (const execution of toolExecutions) {
    if (execution.name !== 'Agent') continue
    const agentId = agentIdInValue(execution.args)
      ?? agentIdInResult(execution.result)
      ?? agentIdInResult(execution.partialResult)
    if (!agentId) {
      if (execution.status !== 'running' || execution.result !== undefined) continue
      const provisionalId = provisionalAgentId(execution.id)
      upsertRow(
        rows,
        provisionalId,
        execution.args,
        execution.result,
        undefined,
        execution.partialResult,
      )
      const row = rows.get(provisionalId)
      if (row) {
        row.status = 'running'
        row.provisional = true
        row.toolCallId = execution.id
        provisionalRows.push(provisionalId)
      }
      continue
    }
    upsertRow(rows, agentId, execution.args, execution.result, undefined, execution.partialResult)
    if (execution.result === undefined) {
      const row = rows.get(agentId)!
      row.status = execution.status === 'interrupted' ? 'cancelled' : 'running'
    }
  }

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of toolCallsInMessage(message)) {
        if (call.name !== 'Agent') continue
        callsById.set(call.id, { agentId: agentIdInValue(call.args), args: call.args })
        const agentId = agentIdInValue(call.args)
        if (agentId) {
          upsertRow(rows, agentId, call.args)
          rows.get(agentId)!.status = 'running'
        }
      }
      continue
    }

    if (message.role === 'toolResult' && message.toolName === 'Agent') {
      const result = toolResultInMessage(message)
      if (!result) continue
      const call = callsById.get(result.toolCallId)
      const agentId = agentIdInValue(result.details) ?? call?.agentId
      if (!agentId) continue
      upsertRow(rows, agentId, call?.args, result)
      continue
    }

    if (message.role === 'custom' && message.customType === 'subagent-notification') {
      const details = isObject(message.details) ? message.details : undefined
      const agentId = agentIdInValue(details)
      if (agentId) upsertRow(rows, agentId, undefined, undefined, details)
    }
  }

  const bridgeAgents = bridgeSnapshot?.agents ?? []
  const bridgeAgentIds = bridgeAgentIdsByToolCallId(toolExecutions, bridgeSnapshot)
  for (const agent of bridgeAgents) {
    applyBridgeAgent(
      rows,
      agent,
      now,
      promoteProvisionalRow(
        rows,
        provisionalRows,
        agent,
        bridgeAgentIds,
        bridgeAgents.filter(({ status }) => status === 'running').length,
      ),
    )
  }

  if (bridgeSnapshot !== undefined) {
    const bridgeAgentIds = new Set(bridgeSnapshot.agents.map(({ agentId }) => agentId))
    for (const row of rows.values()) {
      if (row.status === 'running' && !row.provisional && !bridgeAgentIds.has(row.agentId)) {
        row.status = 'interrupted'
      }
    }
  }

  const allRows = [...rows.values()]
  return {
    active: allRows.filter((row) => row.status === 'running'),
    history: allRows.filter((row) => row.status !== 'running'),
  }
}

function upsertRow(
  rows: Map<string, SubagentMonitorRow>,
  agentId: string,
  args?: unknown,
  result?: ToolResult,
  notification?: JsonObject,
  partialResult?: ToolResult,
): void {
  const row = rows.get(agentId) ?? { agentId }
  const next = { ...row }
  applyArguments(next, args)

  const details = isObject(result?.details)
    ? result.details
    : isObject(notification)
    ? notification
    : isObject(partialResult?.details)
    ? partialResult.details
    : undefined
  if (details) applyDetails(next, details)

  if (result?.isError === true) next.status = 'failed'
  rows.set(agentId, next)
}

function applyArguments(row: SubagentMonitorRow, args: unknown): void {
  if (!isObject(args)) return
  const description = stringValue(args.description)
  if (description !== undefined) row.description = description

  const subagentType = stringValue(args.subagent_type)
    ?? stringValue(args.subagentType)
    ?? stringValue(args.name)
  if (subagentType !== undefined) row.subagentType = subagentType

  const model = requestedModel(args.model)
  if (model !== undefined) row.model = model

  const thinking = stringValue(args.thinking) ?? stringValue(args.thinkingLevel)
  if (thinking !== undefined) row.thinking = thinking
  const effort = stringValue(args.effort)
  if (effort !== undefined) row.effort = effort
}

function applyBridgeAgent(
  rows: Map<string, SubagentMonitorRow>,
  agent: SubagentBridgeAgent,
  now: number,
  provisionalId?: string,
): void {
  let provisional: SubagentMonitorRow | undefined
  if (provisionalId !== undefined) {
    provisional = rows.get(provisionalId)
    if (provisional !== undefined) rows.delete(provisionalId)
  }
  const row = rows.get(agent.agentId) ?? (provisional
    ? withoutProvisional(provisional, agent.agentId)
    : { agentId: agent.agentId })
  if (agent.toolCallId !== undefined) row.toolCallId = agent.toolCallId
  row.description = agent.description
  row.subagentType = agent.type
  row.status = agent.status
  row.childSessionId = agent.childSessionId
  row.startedAt = agent.startedAt
  row.completedAt = agent.completedAt
  row.effectiveModel = agent.model
  row.model = agent.requestedModel ?? row.model
  row.thinking = agent.requestedThinking ?? agent.thinking
  row.latestActivity = agent.latestActivity
  row.toolCount = agent.toolUses
  row.turnCount = agent.turnCount
  row.tokens = agent.tokens
  const endAt = agent.status === 'running' ? now : agent.completedAt ?? agent.startedAt
  row.durationMs = Math.max(0, endAt - agent.startedAt)
  rows.set(agent.agentId, row)
}

/** Promotes the provisional row for the bridge agent's exact or unique correlated call. */
function promoteProvisionalRow(
  rows: Map<string, SubagentMonitorRow>,
  provisionalIds: readonly string[],
  bridgeAgent: SubagentBridgeAgent,
  bridgeAgentIds: ReadonlyMap<string, string>,
  runningBridgeAgentCount: number,
): string | undefined {
  const toolCallId = bridgeAgent.toolCallId
    ?? [...bridgeAgentIds.entries()].find(([, agentId]) => agentId === bridgeAgent.agentId)?.[0]
  if (toolCallId !== undefined) {
    const provisionalId = provisionalAgentId(toolCallId)
    return provisionalIds.includes(provisionalId) && rows.has(provisionalId)
      ? provisionalId
      : undefined
  }
  if (runningBridgeAgentCount !== 1 || provisionalIds.length !== 1) return undefined
  const [provisionalId] = provisionalIds
  const provisional = provisionalId ? rows.get(provisionalId) : undefined
  return provisional && !hasIdentityHints(provisional) ? provisionalId : undefined
}

function hasIdentityHints(row: SubagentMonitorRow): boolean {
  return row.description !== undefined
    || row.subagentType !== undefined
    || row.model !== undefined
    || row.thinking !== undefined
    || row.effort !== undefined
}

function withoutProvisional(row: SubagentMonitorRow, agentId: string): SubagentMonitorRow {
  const promoted = { ...row, agentId }
  delete promoted.provisional
  return promoted
}

function provisionalAgentId(toolCallId: string): string {
  return `provisional:${toolCallId}`
}

function applyDetails(row: SubagentMonitorRow, details: JsonObject): void {
  const status = lifecycle(details.status)
  if (status !== undefined) row.status = status

  const durationMs = finiteNumber(details.durationMs)
    ?? finiteNumber(details.elapsedMs)
    ?? finiteNumber(details.duration)
  if (durationMs !== undefined) row.durationMs = durationMs

  const toolCount = finiteNumber(details.toolCount)
    ?? toolCountValue(details.toolCalls)
  if (toolCount !== undefined) row.toolCount = toolCount

  const tokens = tokenValue(details.tokens) ?? tokenValue(details.usage)
  if (tokens !== undefined) row.tokens = tokens
}

function agentIdInResult(result: ToolResult | undefined): string | undefined {
  return agentIdInValue(result?.details)
}

function agentIdInValue(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  return stringValue(value.agentId)
    ?? stringValue(value.agent_id)
    ?? stringValue(value.taskId)
    ?? stringValue(value.task_id)
    ?? stringValue(value.id)
}

function toolCountValue(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length
  return finiteNumber(value)
}

function tokenValue(value: unknown): number | AgentTokens | undefined {
  const count = finiteNumber(value)
  if (count !== undefined) return count
  if (!isObject(value)) return undefined

  const tokens: AgentTokens = {}
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) {
    const count = finiteNumber(value[key])
    if (count !== undefined) tokens[key] = count
  }
  return Object.keys(tokens).length > 0 ? tokens : undefined
}

function requestedModel(value: unknown): string | RequestedModel | undefined {
  const model = stringValue(value)
  if (model !== undefined) return model
  if (!isObject(value)) return undefined

  const requested: RequestedModel = {}
  const provider = stringValue(value.provider)
  const modelId = stringValue(value.modelId)
  if (provider !== undefined) requested.provider = provider
  if (modelId !== undefined) requested.modelId = modelId
  return Object.keys(requested).length > 0 ? requested : undefined
}

function lifecycle(value: unknown): SubagentLifecycle | undefined {
  if (value === 'background' || value === 'running') return 'running'
  if (value === 'interrupted') return 'interrupted'
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  if (value === 'cancelled') return 'cancelled'
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
