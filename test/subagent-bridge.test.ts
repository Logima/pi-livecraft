import assert from 'node:assert/strict'
import test from 'node:test'
import registerSubagents, {
  type ExtensionAPI,
  type ExtensionContext,
} from '../pi-extensions/subagents.ts'
import {
  maxSubagentBridgePayloadBytes,
  parseSubagentBridgeSnapshot,
} from '../src/features/conversation/subagent-bridge.ts'
import { isObject } from '../shared/is-object.ts'

const registryKey = Symbol.for('pi-subagents:manager')

function bridgeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: 'manager-agent-1',
    childSessionId: 'child-session-1',
    toolCallId: 'tool-call-1',
    childSessionPath: '/secret/session.jsonl',
    type: 'Explore',
    description: 'Inspect the API',
    status: 'running',
    startedAt: 1_700_000_000_000,
    model: { provider: 'openai', modelId: 'gpt-5' },
    thinking: 'medium',
    requestedModel: 'openai/gpt-5',
    requestedThinking: 'medium',
    toolUses: 2,
    turnCount: 1,
    latestActivity: 'read',
    tokens: { input: 10, output: 20, cacheWrite: 3 },
    ...overrides,
  }
}

function validStatusText(row = bridgeRow()): string {
  return JSON.stringify({ schemaVersion: 1, agents: [{ ...row, childSessionPath: undefined }] })
}

function fakeContext(): ExtensionContext {
  return {
    sessionManager: { getHeader: () => null },
    ui: { setStatus: () => undefined },
  } as unknown as ExtensionContext
}

function fakePi(handlers: Map<string, (...args: never[]) => unknown>): ExtensionAPI {
  return {
    on: (event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler)
      return () => undefined
    },
    events: {
      on: () => () => undefined,
      emit: () => undefined,
    },
    registerCommand: () => undefined,
  } as unknown as ExtensionAPI
}

test('strictly parses bridge snapshots and keeps IDs distinct', () => {
  const parsed = parseSubagentBridgeSnapshot(validStatusText())
  assert.ok(parsed)
  assert.equal(parsed.agents[0].agentId, 'manager-agent-1')
  assert.equal(parsed.agents[0].childSessionId, 'child-session-1')
  assert.equal(parsed.agents[0].toolCallId, 'tool-call-1')
})

test('parses an empty bridge snapshot for refresh replay', () => {
  const parsed = parseSubagentBridgeSnapshot(JSON.stringify({ schemaVersion: 1, agents: [] }))
  assert.ok(parsed)
  assert.deepEqual(parsed.agents, [])
})

test('rejects malformed, unknown-version, oversized, and path-bearing rows', () => {
  assert.equal(parseSubagentBridgeSnapshot('{"schemaVersion":2,"agents":[]}'), undefined)
  assert.equal(
    parseSubagentBridgeSnapshot(
      JSON.stringify({ schemaVersion: 1, agents: [bridgeRow({ toolCallId: 42 })] }),
    ),
    undefined,
  )
  assert.equal(
    parseSubagentBridgeSnapshot(
      JSON.stringify({ schemaVersion: 1, agents: [bridgeRow({ toolCallId: 'x'.repeat(201) })] }),
    ),
    undefined,
  )
  assert.equal(
    parseSubagentBridgeSnapshot(
      JSON.stringify({ schemaVersion: 1, agents: [bridgeRow({ extra: true })] }),
    ),
    undefined,
  )
  assert.equal(parseSubagentBridgeSnapshot('{"schemaVersion":1,"agents":[{}]}'), undefined)
  assert.equal(
    parseSubagentBridgeSnapshot(JSON.stringify({ schemaVersion: 1, agents: [bridgeRow()] })),
    undefined,
  )
  assert.equal(
    parseSubagentBridgeSnapshot('x'.repeat(maxSubagentBridgePayloadBytes + 1)),
    undefined,
  )
})

test('companion is inert without a compatible registry', () => {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const statuses: unknown[] = []
  Object.defineProperty(globalThis, registryKey, { configurable: true, value: undefined })
  const context = {
    ...fakeContext(),
    ui: { setStatus: (...args: unknown[]) => statuses.push(args) },
  } as unknown as ExtensionContext
  registerSubagents(fakePi(handlers))
  handlers.get('session_start')?.(undefined as never, context as never)
  assert.deepEqual(statuses, [])
})

test('companion strips paths and deduplicates unchanged snapshots', () => {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const statuses: string[] = []
  let listener: ((snapshot: unknown) => void) | undefined
  const runningSnapshot = { schemaVersion: 1, agents: [bridgeRow({ status: 'running' })] }
  const steeredSnapshot = {
    schemaVersion: 1,
    agents: [{ ...bridgeRow({ status: 'steered' }), completedAt: 1_700_000_001_000 }],
  }
  Object.defineProperty(globalThis, registryKey, {
    configurable: true,
    value: {
      getSnapshot: () => runningSnapshot,
      getRecord: () => ({
        toolCallId: 'tool-call-1',
        session: { subscribe: () => () => undefined },
      }),
      subscribe: (next: (value: unknown) => void) => {
        listener = next
        return () => undefined
      },
    },
  })
  const context = {
    ...fakeContext(),
    ui: { setStatus: (_key: string, text: string) => statuses.push(text) },
  } as unknown as ExtensionContext
  registerSubagents(fakePi(handlers))
  handlers.get('session_start')?.(undefined as never, context as never)
  listener?.(runningSnapshot)
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].includes('childSessionPath'), false)
  assert.equal(JSON.parse(statuses[0]).agents[0].toolCallId, 'tool-call-1')
  listener?.(steeredSnapshot)
  assert.equal(statuses.length, 2)
  const normalized: unknown = JSON.parse(statuses[1])
  assert.ok(isObject(normalized) && Array.isArray(normalized.agents))
  const normalizedAgent = normalized.agents[0]
  assert.ok(isObject(normalizedAgent))
  assert.equal(normalizedAgent.status, 'completed')
})

test('companion omits an unbounded registry toolCallId', () => {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const statuses: string[] = []
  Object.defineProperty(globalThis, registryKey, {
    configurable: true,
    value: {
      getSnapshot: () => ({ schemaVersion: 1, agents: [bridgeRow()] }),
      getRecord: () => ({ toolCallId: 'x'.repeat(201) }),
      subscribe: () => () => undefined,
    },
  })
  const context = {
    ...fakeContext(),
    ui: { setStatus: (_key: string, text: string) => statuses.push(text) },
  } as unknown as ExtensionContext
  registerSubagents(fakePi(handlers))
  handlers.get('session_start')?.(undefined as never, context as never)

  assert.equal(statuses.length, 1)
  const normalized: unknown = JSON.parse(statuses[0])
  assert.ok(isObject(normalized) && Array.isArray(normalized.agents))
  assert.equal(isObject(normalized.agents[0]) && 'toolCallId' in normalized.agents[0], false)
})
