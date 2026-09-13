import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bridgeAgentIdsByToolCallId,
  resolveToolCallAgentId,
} from '../src/features/conversation/tool-call-agent.ts'
import type { ToolExecution } from '../src/features/conversation/tool-protocol.ts'
import type { SubagentBridgeSnapshot } from '../src/features/conversation/subagent-bridge.ts'

test('maps a foreground bridge identity to the Agent card', () => {
  const execution: ToolExecution = {
    id: 'call-foreground',
    name: 'Agent',
    args: {
      description: 'Inspect the API',
      subagent_type: 'Explore',
      model: 'gpt-5',
      thinking: 'medium',
    },
    status: 'running',
  }
  const bridge: SubagentBridgeSnapshot = {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-live',
      type: 'Explore',
      description: 'Inspect the API',
      status: 'running',
      startedAt: 1,
      requestedModel: 'gpt-5',
      requestedThinking: 'medium',
      toolUses: 0,
      turnCount: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  }
  const mapping = bridgeAgentIdsByToolCallId([execution], bridge)

  assert.equal(mapping.get(execution.id), 'agent-live')
  assert.equal(resolveToolCallAgentId(undefined, mapping.get(execution.id)), 'agent-live')
})

test('resolves a live Agent card identity from the bridge and prefers its completed result', () => {
  assert.equal(resolveToolCallAgentId(undefined, 'agent-live'), 'agent-live')
  assert.equal(
    resolveToolCallAgentId({ agentId: 'agent-completed' }, 'agent-live'),
    'agent-completed',
  )
  assert.equal(resolveToolCallAgentId({ status: 'running' }, undefined), undefined)
})
