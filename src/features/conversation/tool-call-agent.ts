import { isObject } from '../../../shared/is-object.ts'
import type { SubagentBridgeAgent, SubagentBridgeSnapshot } from './subagent-bridge.ts'
import type { ToolExecution } from './tool-protocol.ts'

interface AgentIdentityHints {
  description?: string
  subagentType?: string
  requestedModel?: string
  requestedThinking?: string
  requestedEffort?: string
}

type BridgeAgentIdentity = SubagentBridgeAgent & {
  requestedEffort?: unknown
  effort?: unknown
}

/**
 * Resolves running bridge agents to parent Agent executions.
 *
 * Explicit bridge tool-call IDs are authoritative. Foreground executions do not
 * always have that ID in the registry, so an ID-less bridge row may use only a
 * unique, bidirectional match over the identity fields both sides provide.
 */
export function bridgeAgentIdsByToolCallId(
  executions: readonly ToolExecution[],
  snapshot?: SubagentBridgeSnapshot,
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>()
  const runningAgents = (snapshot?.agents ?? []).filter((agent) => agent.status === 'running')

  for (const agent of runningAgents) {
    if (agent.toolCallId !== undefined && !resolved.has(agent.toolCallId)) {
      resolved.set(agent.toolCallId, agent.agentId)
    }
  }

  const unresolvedExecutions = executions.filter((execution) =>
    execution.name === 'Agent'
    && execution.status === 'running'
    && execution.result === undefined
    && !resolved.has(execution.id)
  )
  const idlessAgents = runningAgents.filter((agent) => agent.toolCallId === undefined)
  const matchesByExecution = unresolvedExecutions.map((execution) => ({
    execution,
    agents: idlessAgents.filter((agent) =>
      identityMatches(
        executionIdentity(execution),
        bridgeIdentity(agent),
      )
    ),
  }))

  for (const match of matchesByExecution) {
    if (match.agents.length !== 1) continue
    const [agent] = match.agents
    if (!agent) continue
    const matchingExecutions = matchesByExecution.filter(({ agents }) =>
      agents.some(({ agentId }) => agentId === agent.agentId)
    )
    if (matchingExecutions.length === 1) {
      resolved.set(match.execution.id, agent.agentId)
    }
  }

  return resolved
}

/** Returns the authoritative running bridge records matched to parent Agent calls. */
export function bridgeAgentsByToolCallId(
  executions: readonly ToolExecution[],
  snapshot?: SubagentBridgeSnapshot,
): ReadonlyMap<string, SubagentBridgeAgent> {
  const ids = bridgeAgentIdsByToolCallId(executions, snapshot)
  const agentsById = new Map((snapshot?.agents ?? []).map((agent) => [agent.agentId, agent]))
  const resolved = new Map<string, SubagentBridgeAgent>()
  for (const [toolCallId, agentId] of ids) {
    const agent = agentsById.get(agentId)
    if (agent) resolved.set(toolCallId, agent)
  }
  return resolved
}

/** Selects the bounded activity label for an Agent card with a correlated running bridge row. */
export function agentPendingStatus(
  bridgeAgentId: string | undefined,
  latestActivity?: string,
): string | undefined {
  if (bridgeAgentId === undefined) return undefined
  const activity = latestActivity?.trim()
  return activity || 'Running…'
}

/** Prefers the persisted result identity and falls back to the correlated bridge identity. */
export function resolveToolCallAgentId(
  resultDetails: unknown,
  bridgeAgentId?: string,
): string | undefined {
  if (isObject(resultDetails) && typeof resultDetails.agentId === 'string')
    return resultDetails.agentId
  return bridgeAgentId
}

function executionIdentity(execution: ToolExecution): AgentIdentityHints {
  const args = isObject(execution.args) ? execution.args : undefined
  return {
    description: stringHint(args?.description),
    subagentType: stringHint(args?.subagent_type)
      ?? stringHint(args?.subagentType)
      ?? stringHint(args?.name),
    requestedModel: modelHint(args?.model),
    requestedThinking: stringHint(args?.thinking) ?? stringHint(args?.thinkingLevel),
    requestedEffort: stringHint(args?.effort),
  }
}

function bridgeIdentity(agent: SubagentBridgeAgent): AgentIdentityHints {
  const candidate = agent as BridgeAgentIdentity
  return {
    description: agent.description,
    subagentType: agent.type,
    requestedModel: agent.requestedModel,
    requestedThinking: agent.requestedThinking ?? agent.thinking,
    requestedEffort: stringHint(candidate.requestedEffort) ?? stringHint(candidate.effort),
  }
}

/** Requires every identity hint present on both sides to agree. */
function identityMatches(left: AgentIdentityHints, right: AgentIdentityHints): boolean {
  let compared = 0
  for (
    const key of [
      'description',
      'subagentType',
      'requestedModel',
      'requestedThinking',
      'requestedEffort',
    ] as const
  ) {
    const leftValue = left[key]
    const rightValue = right[key]
    if (leftValue === undefined || rightValue === undefined) continue
    compared += 1
    if (leftValue !== rightValue) return false
  }
  return compared > 0
}

function modelHint(value: unknown): string | undefined {
  const direct = stringHint(value)
  if (direct !== undefined) return direct
  if (!isObject(value)) return undefined
  const provider = stringHint(value.provider)
  const modelId = stringHint(value.modelId)
  if (provider === undefined) return modelId
  if (modelId === undefined) return provider
  return `${provider}/${modelId}`
}

function stringHint(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
