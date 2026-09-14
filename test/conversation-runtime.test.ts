import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionSnapshot } from '../shared/types.ts'
import { advanceEventSequence } from '../src/features/conversation/event-sequence.ts'
import { mergeCachedRelayEvents } from '../src/features/conversation/snapshot-reconciliation.ts'

function snapshotWithLiveEvents(sequence: number): SessionSnapshot {
  return {
    state: null,
    messages: [],
    models: [],
    commands: [],
    promptTemplates: [],
    stats: null,
    liveEvents: [{ data: { type: 'agent_start' }, sequence }],
  }
}

test('accepts live events once while leaving unsequenced events untouched', () => {
  assert.equal(advanceEventSequence(4, 5), 5)
  assert.equal(advanceEventSequence(5, 5), null)
  assert.equal(advanceEventSequence(5, 3), null)
  assert.equal(advanceEventSequence(5), 5)
})

test('does not replay cached active events for a finished normal session', () => {
  const cached = snapshotWithLiveEvents(1)
  const finished: SessionSnapshot = { ...cached, liveEvents: [] }

  assert.deepEqual(mergeCachedRelayEvents(cached, finished, false), finished)
  assert.deepEqual(
    mergeCachedRelayEvents(cached, finished, true).liveEvents,
    cached.liveEvents,
  )
})
