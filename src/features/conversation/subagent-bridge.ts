import { isObject } from '../../../shared/is-object.ts'

export const subagentBridgeStatusKey = 'pi-livecraft.subagents'
export const subagentBridgeSchemaVersion = 1
export const maxSubagentBridgePayloadBytes = 32_768

const maxAgents = 100
const maxStringLength = 240
const maxSessionIdLength = 200
const maxCounter = 1_000_000_000

export type SubagentBridgeLifecycle = 'running' | 'completed' | 'failed' | 'cancelled'

export interface SubagentBridgeModel {
  provider: string
  modelId: string
}

export interface SubagentBridgeTokens {
  input: number
  output: number
  cacheWrite: number
}

export interface SubagentBridgeAgent {
  agentId: string
  /** Identifies the parent Agent ToolExecution that started this bridge agent. */
  toolCallId?: string
  childSessionId?: string
  type: string
  description: string
  status: SubagentBridgeLifecycle
  startedAt: number
  completedAt?: number
  model?: SubagentBridgeModel
  thinking?: string
  requestedModel?: string
  requestedThinking?: string
  toolUses: number
  turnCount: number
  latestActivity?: string
  tokens: SubagentBridgeTokens
}

export interface SubagentBridgeSnapshot {
  schemaVersion: typeof subagentBridgeSchemaVersion
  agents: readonly SubagentBridgeAgent[]
}

/** Parses the bounded status text emitted by the Livecraft companion extension. */
export function parseSubagentBridgeSnapshot(value: unknown): SubagentBridgeSnapshot | undefined {
  if (typeof value !== 'string' || byteLength(value) > maxSubagentBridgePayloadBytes)
    return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!isObject(parsed) || parsed.schemaVersion !== subagentBridgeSchemaVersion) return undefined
  if (!Array.isArray(parsed.agents) || parsed.agents.length > maxAgents) return undefined

  const agents: SubagentBridgeAgent[] = []
  for (const row of parsed.agents) {
    const agent = parseAgent(row)
    if (!agent) return undefined
    agents.push(agent)
  }
  return { schemaVersion: subagentBridgeSchemaVersion, agents }
}

function parseAgent(value: unknown): SubagentBridgeAgent | undefined {
  if (!isObject(value)) return undefined
  if (
    !hasOnlyKeys(value, [
      'agentId',
      'toolCallId',
      'childSessionId',
      'type',
      'description',
      'status',
      'startedAt',
      'completedAt',
      'model',
      'thinking',
      'requestedModel',
      'requestedThinking',
      'toolUses',
      'turnCount',
      'latestActivity',
      'tokens',
    ])
  ) return undefined

  const agentId = boundedString(value.agentId, maxSessionIdLength)
  const toolCallId = optionalString(value.toolCallId, maxSessionIdLength)
  const type = boundedString(value.type, maxStringLength)
  const description = boundedString(value.description, maxStringLength)
  const status = lifecycle(value.status)
  const startedAt = timestamp(value.startedAt)
  const toolUses = counter(value.toolUses)
  const turnCount = counter(value.turnCount)
  const tokens = parseTokens(value.tokens)
  if (
    !agentId || (value.toolCallId !== undefined && toolCallId === undefined)
    || !type || !description || !status || startedAt === undefined
    || toolUses === undefined || turnCount === undefined || !tokens
  ) return undefined

  const childSessionId = optionalString(value.childSessionId, maxSessionIdLength)
  const completedAt = optionalTimestamp(value.completedAt)
  const thinking = optionalString(value.thinking, maxStringLength)
  const requestedModel = optionalString(value.requestedModel, maxStringLength)
  const requestedThinking = optionalString(value.requestedThinking, maxStringLength)
  const latestActivity = optionalString(value.latestActivity, maxStringLength)
  if (value.childSessionId !== undefined && childSessionId === undefined)
    return undefined
  if (value.completedAt !== undefined && completedAt === undefined) return undefined
  if (value.thinking !== undefined && thinking === undefined) return undefined
  if (value.requestedModel !== undefined && requestedModel === undefined) return undefined
  if (value.requestedThinking !== undefined && requestedThinking === undefined) return undefined
  if (value.latestActivity !== undefined && latestActivity === undefined) return undefined

  const model = parseModel(value.model)
  if (value.model !== undefined && !model) return undefined
  return {
    agentId,
    ...(toolCallId ? { toolCallId } : {}),
    ...(childSessionId ? { childSessionId } : {}),
    type,
    description,
    status,
    startedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(requestedModel ? { requestedModel } : {}),
    ...(requestedThinking ? { requestedThinking } : {}),
    toolUses,
    turnCount,
    ...(latestActivity ? { latestActivity } : {}),
    tokens,
  }
}

function parseTokens(value: unknown): SubagentBridgeTokens | undefined {
  if (!isObject(value) || !hasOnlyKeys(value, ['input', 'output', 'cacheWrite'])) return undefined
  const input = counter(value.input)
  const output = counter(value.output)
  const cacheWrite = counter(value.cacheWrite)
  return input !== undefined && output !== undefined && cacheWrite !== undefined
    ? { input, output, cacheWrite }
    : undefined
}

function parseModel(value: unknown): SubagentBridgeModel | undefined {
  if (!isObject(value) || !hasOnlyKeys(value, ['provider', 'modelId'])) return undefined
  const provider = boundedString(value.provider, maxStringLength)
  const modelId = boundedString(value.modelId, maxStringLength)
  return provider && modelId ? { provider, modelId } : undefined
}

function lifecycle(value: unknown): SubagentBridgeLifecycle | undefined {
  if (value === 'running' || value === 'completed' || value === 'failed' || value === 'cancelled') {
    return value
  }
  return undefined
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return value === undefined ? undefined : boundedString(value, maxLength)
}

function counter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      && value <= maxCounter
    ? value
    : undefined
}

function timestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function optionalTimestamp(value: unknown): number | undefined {
  return value === undefined ? undefined : timestamp(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
