import { randomUUID } from 'node:crypto'
import { isObject } from '../shared/is-object.ts'
import { serializeSubagentRelayEnvelope, subagentEventStatusKey } from '../shared/subagent-relay.ts'

const registryKey = Symbol.for('pi-subagents:manager')
const statusKey = 'pi-livecraft.subagents'
const schemaVersion = 1
const stopRequestChannel = 'subagents:rpc:stop'
const stopReplyChannelPrefix = 'subagents:rpc:stop:reply:'
const stopTimeoutMs = 5_000
const maxPayloadBytes = 32_768
const maxAgents = 100
const maxStringLength = 240
const maxSessionIdLength = 200
const maxCounter = 1_000_000_000

type BridgeStatus = 'running' | 'completed' | 'failed' | 'cancelled'

interface SessionHeader {
  parentSession?: string
}

interface ExtensionSessionManager {
  getHeader: () => SessionHeader | null
}

interface ExtensionUi {
  setStatus: (key: string, text: string) => void
  notify: (message: string, level: string) => void
}

/** Minimal public Pi extension context used by this companion. */
export interface ExtensionContext {
  sessionManager: ExtensionSessionManager
  ui: ExtensionUi
}

export interface ExtensionCommandContext extends ExtensionContext {}

interface ExtensionEvents {
  on: (channel: string, listener: (value: unknown) => void) => () => void
  emit: (channel: string, data: unknown) => void
}

interface ExtensionCommand {
  description: string
  handler: (args: string, ctx: ExtensionCommandContext) => void | Promise<void>
}

/** Minimal public Pi extension API used by this companion. */
export interface ExtensionAPI {
  on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => void
  events: ExtensionEvents
  registerCommand: (name: string, command: ExtensionCommand) => void
}

type AgentSessionEvent = Record<string, unknown>

type PublicAgentSession = {
  subscribe: (listener: (event: AgentSessionEvent) => void) => () => void
}

interface ManagerRegistry {
  getSnapshot: () => unknown
  getRecord: (agentId: string) => unknown
  subscribe: (listener: (snapshot: unknown) => void) => () => void
}

interface RelaySubscription {
  session: PublicAgentSession
  childSessionId: string
  unsubscribe: () => void
  sequence: number
}

/** Publishes pi-subagents lifecycle data through a reserved, non-message UI status. */
export default function registerSubagents(pi: ExtensionAPI): void {
  let unsubscribeRegistry: (() => void) | undefined
  const subscriptions = new Map<string, RelaySubscription>()

  pi.registerCommand('livecraft-stop-subagent', {
    description: 'Stop an owned pi-subagents child from Livecraft',
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const agentId = args.trim()
      if (!isBoundedIdentifier(agentId)) throw new Error('A valid subagent ID is required')
      await requestStop(pi, agentId)
      ctx.ui.notify(`Stop requested for subagent ${agentId}`, 'info')
    },
  })

  pi.on('session_start', (_event, ctx) => {
    unsubscribeRegistry?.()
    unsubscribeRegistry = undefined
    clearSubscriptions(subscriptions)
    if (!isRootSession(ctx)) return

    const registry = managerRegistry()
    if (!registry) return
    let lastStatusText: string | undefined
    const publish = (value: unknown): void => {
      const normalizedSnapshot = normalizeSnapshot(value)
      if (!normalizedSnapshot) return
      const snapshot = normalizedSnapshot.map((agent) => {
        const agentId = agent.agentId
        return typeof agentId === 'string'
          ? enrichAgentWithRecord(agent, registry.getRecord(agentId))
          : agent
      })
      const statusText = serializeSnapshot(snapshot)
      if (statusText && statusText !== lastStatusText) {
        lastStatusText = statusText
        ctx.ui.setStatus(statusKey, statusText)
      }
      reconcileSubscriptions(
        registry,
        snapshot,
        subscriptions,
        (agentId, childSessionId, event) => {
          const sequence = (subscriptions.get(agentId)?.sequence ?? 0) + 1
          const current = subscriptions.get(agentId)
          if (current) current.sequence = sequence
          const payload = serializeSubagentRelayEnvelope(agentId, childSessionId, sequence, event)
          if (payload) ctx.ui.setStatus(subagentEventStatusKey, payload)
        },
      )
    }

    try {
      // Some registries notify on subscribe; the explicit read also covers registries that do not.
      publish(registry.getSnapshot())
      unsubscribeRegistry = registry.subscribe(publish)
    } catch {
      unsubscribeRegistry = undefined
      clearSubscriptions(subscriptions)
    }
  })

  pi.on('session_shutdown', () => {
    unsubscribeRegistry?.()
    unsubscribeRegistry = undefined
    clearSubscriptions(subscriptions)
  })
}

function reconcileSubscriptions(
  registry: ManagerRegistry,
  agents: readonly Record<string, unknown>[],
  subscriptions: Map<string, RelaySubscription>,
  onEvent: (agentId: string, childSessionId: string, event: Record<string, unknown>) => void,
): void {
  const seen = new Set<string>()
  for (const agent of agents) {
    const agentId = typeof agent.agentId === 'string' ? agent.agentId : undefined
    const childSessionId = typeof agent.childSessionId === 'string'
      ? agent.childSessionId
      : undefined
    if (!agentId || !childSessionId) continue
    seen.add(agentId)
    const record = registry.getRecord(agentId)
    if (!hasAgentSession(record)) {
      subscriptions.get(agentId)?.unsubscribe()
      subscriptions.delete(agentId)
      continue
    }
    const previous = subscriptions.get(agentId)
    if (previous?.session === record.session && previous.childSessionId === childSessionId) continue
    previous?.unsubscribe()
    const subscription: RelaySubscription = {
      session: record.session,
      childSessionId,
      sequence: 0,
      unsubscribe: () => undefined,
    }
    subscription.unsubscribe = record.session.subscribe((event: AgentSessionEvent) => {
      const jsonEvent: unknown = event
      if (!isObject(jsonEvent)) return
      const current = subscriptions.get(agentId)
      if (!current || current.session !== record.session) return
      onEvent(agentId, current.childSessionId, jsonEvent)
    })
    subscriptions.set(agentId, subscription)
  }
  for (const [agentId, subscription] of subscriptions) {
    if (seen.has(agentId)) continue
    subscription.unsubscribe()
    subscriptions.delete(agentId)
  }
}

function clearSubscriptions(subscriptions: Map<string, RelaySubscription>): void {
  for (const subscription of subscriptions.values()) subscription.unsubscribe()
  subscriptions.clear()
}

function hasAgentSession(value: unknown): value is { session: PublicAgentSession } {
  return isObject(value) && isObject(value.session) && typeof value.session.subscribe === 'function'
}

async function requestStop(pi: ExtensionAPI, agentId: string): Promise<void> {
  const requestId = randomUUID()
  const replyChannel = `${stopReplyChannelPrefix}${requestId}`
  const reply = await new Promise<unknown>((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => undefined
    const timeout = setTimeout(
      () => finish(() => reject(new Error('Timed out waiting for subagent stop'))),
      stopTimeoutMs,
    )
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timeout)
      callback()
    }
    unsubscribe = pi.events.on(replyChannel, (value) => finish(() => resolve(value)))
    pi.events.emit(stopRequestChannel, { requestId, agentId })
  })
  if (!isObject(reply) || reply.success !== true) {
    const error = isObject(reply) && typeof reply.error === 'string'
      ? reply.error
      : 'Subagent stop failed'
    throw new Error(error)
  }
}

function isBoundedIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= maxSessionIdLength && !/[\u0000-\u001f]/.test(value)
}

function managerRegistry(): ManagerRegistry | undefined {
  const candidate: unknown = Reflect.get(globalThis, registryKey)
  if (
    !isObject(candidate) || typeof candidate.getSnapshot !== 'function'
    || typeof candidate.getRecord !== 'function' || typeof candidate.subscribe !== 'function'
  ) return undefined
  return {
    getSnapshot: candidate.getSnapshot.bind(candidate),
    getRecord: candidate.getRecord.bind(candidate),
    subscribe: candidate.subscribe.bind(candidate),
  }
}

function isRootSession(ctx: ExtensionContext): boolean {
  const header = ctx.sessionManager.getHeader()
  return header?.parentSession === undefined
}

function serializeSnapshot(snapshot: readonly Record<string, unknown>[]): string | undefined {
  const agents: Record<string, unknown>[] = []
  for (const agent of snapshot) {
    const candidate = JSON.stringify({ schemaVersion, agents: [...agents, agent] })
    if (byteLength(candidate) > maxPayloadBytes) break
    agents.push(agent)
  }
  return JSON.stringify({ schemaVersion, agents })
}

function normalizeSnapshot(value: unknown): Record<string, unknown>[] | undefined {
  if (
    !isObject(value) || value.schemaVersion !== schemaVersion
    || !Array.isArray(value.agents) || value.agents.length > maxAgents
  ) return undefined
  const agents: Record<string, unknown>[] = []
  for (const row of value.agents) {
    const agent = normalizeAgent(row)
    if (!agent) return undefined
    agents.push(agent)
  }
  return agents
}

function enrichAgentWithRecord(
  agent: Record<string, unknown>,
  record: unknown,
): Record<string, unknown> {
  if (!isObject(record)) return agent
  const toolCallId = record.toolCallId
  if (typeof toolCallId !== 'string' || !isBoundedIdentifier(toolCallId)) return agent
  return { ...agent, toolCallId }
}

function normalizeAgent(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value)) return undefined
  const agentId = requiredString(value.agentId, maxSessionIdLength)
  const type = requiredString(value.type, maxStringLength)
  const description = requiredString(value.description, maxStringLength)
  const status = normalizeStatus(value.status)
  const startedAt = timestamp(value.startedAt)
  const toolUses = counter(value.toolUses)
  const turnCount = counter(value.turnCount)
  const tokens = normalizeTokens(value.tokens)
  if (
    !agentId || !type || !description || !status || startedAt === undefined
    || toolUses === undefined || turnCount === undefined || !tokens
  ) return undefined

  const childSessionId = optionalString(value.childSessionId, maxSessionIdLength)
  const completedAt = optionalTimestamp(value.completedAt)
  const model = normalizeModel(value.model)
  const thinking = optionalString(value.thinking, maxStringLength)
  const requestedModel = optionalString(value.requestedModel, maxStringLength)
  const requestedThinking = optionalString(value.requestedThinking, maxStringLength)
  const latestActivity = optionalString(value.latestActivity, maxStringLength)
  if (value.childSessionId !== undefined && childSessionId === undefined)
    return undefined
  if (value.completedAt !== undefined && completedAt === undefined) return undefined
  if (value.model !== undefined && !model) return undefined
  if (value.thinking !== undefined && thinking === undefined) return undefined
  if (value.requestedModel !== undefined && requestedModel === undefined) return undefined
  if (value.requestedThinking !== undefined && requestedThinking === undefined) return undefined
  if (value.latestActivity !== undefined && latestActivity === undefined) return undefined

  return {
    agentId,
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

function normalizeTokens(value: unknown): Record<string, number> | undefined {
  if (!isObject(value)) return undefined
  const input = counter(value.input)
  const output = counter(value.output)
  const cacheWrite = counter(value.cacheWrite)
  return input !== undefined && output !== undefined && cacheWrite !== undefined
    ? { input, output, cacheWrite }
    : undefined
}

function normalizeModel(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined
  const provider = requiredString(value.provider, maxStringLength)
  const modelId = requiredString(value.modelId, maxStringLength)
  return provider && modelId ? { provider, modelId } : undefined
}

function normalizeStatus(value: unknown): BridgeStatus | undefined {
  if (value === 'queued' || value === 'running') return 'running'
  if (value === 'steered') return 'completed'
  if (value === 'completed') return 'completed'
  if (value === 'error') return 'failed'
  if (value === 'aborted' || value === 'stopped') return 'cancelled'
  return undefined
}

function requiredString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, maxLength)
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
