import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maxSubagentEventPayloadBytes,
  parseSubagentRelayEnvelope,
  serializeSubagentRelayEnvelope,
} from '../shared/subagent-relay.ts'

test('round-trips a bounded child event envelope', () => {
  const value = serializeSubagentRelayEnvelope(
    'agent-1',
    'child-1',
    1,
    { type: 'message_update', delta: 'partial response' },
  )
  assert.ok(value)
  assert.deepEqual(parseSubagentRelayEnvelope(value), {
    schemaVersion: 1,
    agentId: 'agent-1',
    childSessionId: 'child-1',
    sequence: 1,
    event: { type: 'message_update', delta: 'partial response' },
  })
})

test('rejects malformed, oversized, and invalid-sequence envelopes', () => {
  assert.equal(parseSubagentRelayEnvelope('{"schemaVersion":2}'), undefined)
  assert.equal(
    parseSubagentRelayEnvelope(
      JSON.stringify({
        schemaVersion: 1,
        agentId: 'agent-1',
        childSessionId: 'child-1',
        sequence: 0,
        event: { type: 'agent_start' },
      }),
    ),
    undefined,
  )
  assert.equal(
    parseSubagentRelayEnvelope(
      JSON.stringify({
        schemaVersion: 1,
        agentId: 'agent-1',
        childSessionId: 'child-1',
        sequence: 1,
        event: { type: 'agent_start' },
        extra: true,
      }),
    ),
    undefined,
  )
  assert.equal(
    parseSubagentRelayEnvelope('x'.repeat(maxSubagentEventPayloadBytes + 1)),
    undefined,
  )
  assert.equal(
    serializeSubagentRelayEnvelope('agent-1', 'child-1', 1, {
      type: 'message_update',
      delta: 'x'.repeat(maxSubagentEventPayloadBytes),
    }),
    undefined,
  )
})
