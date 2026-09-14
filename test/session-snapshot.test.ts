import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeSessionMessages,
  LiveSessionEvents,
  visibleSessionMessages,
} from '../server/session-snapshot.ts'

test('retains only the events needed to restore active thinking and tools', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'agent_start' }, 1)
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 2)
  live.receive({
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspecting' }] },
    assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting' },
  }, 3)
  live.receive({
    type: 'message_update',
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Inspecting' }, {
        type: 'toolCall',
        id: 'call-1',
        name: 'read',
        arguments: {},
      }],
    },
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1 },
  }, 4)
  live.receive(
    { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read', args: {} },
    5,
  )
  live.receive({
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName: 'read',
    partialResult: { content: 'partial' },
  }, 6)

  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1, 2, 4, 5, 6])

  live.receive({ type: 'message_end' }, 7)
  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1, 5, 6])
  live.receive({ type: 'tool_execution_end', toolCallId: 'call-1' }, 8)
  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [1])
  live.receive({ type: 'agent_settled' }, 9)
  assert.deepEqual(live.snapshot(), [])
})

test('replays an in-progress relayed child turn in event order', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'agent_start' }, 101)
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 102)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Buffered' },
  }, 103)
  live.receive({ type: 'agent_end' }, 104)

  assert.deepEqual(live.snapshot().map(({ sequence }) => sequence), [101, 102, 103])
  assert.equal(live.snapshot().at(-1)?.data.type, 'message_update')
  assert.deepEqual(live.snapshot().at(-1)?.data.message, {
    role: 'assistant',
    content: [{ type: 'text', text: 'Buffered' }],
  })
})

test('replays completed relayed tool executions after refresh', () => {
  const live = new LiveSessionEvents(true)
  live.receive({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read', args: {} }, 1)
  live.receive({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'read',
    result: { content: 'done' },
  }, 2)
  live.receive({ type: 'agent_settled' }, 3)

  assert.deepEqual(live.snapshot().map(({ data }) => data.type), [
    'tool_execution_start',
    'tool_execution_end',
  ])
})

test('retains the latest steering queue for snapshot replay', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'queue_update', steering: ['First'] }, 1)
  live.receive({ type: 'queue_update', steering: ['First', 'Second'] }, 2)

  assert.deepEqual(live.snapshot(), [{
    data: { type: 'queue_update', steering: ['First', 'Second'] },
    sequence: 2,
  }])

  live.receive({ type: 'agent_settled' }, 3)
  assert.deepEqual(live.snapshot(), [])
})

test('stores an assembled assistant message for delta-only replay', () => {
  const live = new LiveSessionEvents()
  live.receive({ type: 'message_start', message: { role: 'assistant', content: [] } }, 1)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
  }, 2)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
  }, 3)
  live.receive({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' },
  }, 4)

  assert.deepEqual(live.snapshot().at(-1)?.data.message, {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
  })
})

test('keeps the active conversation before and after compaction', () => {
  const messages = activeSessionMessages([
    {
      type: 'message',
      id: 'user-1',
      parentId: null,
      message: { role: 'user', content: 'Original request' },
    },
    {
      type: 'message',
      id: 'assistant-1',
      parentId: 'user-1',
      message: { role: 'assistant', content: 'Original response' },
    },
    {
      type: 'message',
      id: 'abandoned',
      parentId: 'user-1',
      message: { role: 'assistant', content: 'Abandoned branch' },
    },
    { type: 'compaction', id: 'compact-1', parentId: 'assistant-1', summary: 'Summary' },
    {
      type: 'message',
      id: 'user-2',
      parentId: 'compact-1',
      message: { role: 'user', content: 'Continue' },
    },
  ], 'user-2')

  assert.deepEqual(messages, [
    { role: 'user', content: 'Original request' },
    { role: 'assistant', content: 'Original response' },
    { role: 'custom', customType: 'compaction', content: 'Summary', display: true },
    { role: 'user', content: 'Continue' },
  ])
})

test('marks forkable user messages by entry ID instead of duplicated text', () => {
  const messages = activeSessionMessages(
    [
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        message: { role: 'user', content: 'Repeat this' },
      },
      {
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        message: { role: 'assistant', content: 'Done' },
      },
      {
        type: 'message',
        id: 'user-2',
        parentId: 'assistant-1',
        message: { role: 'user', content: 'Repeat this' },
      },
    ],
    'user-2',
    new Set(['user-2', 'assistant-1']),
  )

  assert.deepEqual(messages, [
    { role: 'user', content: 'Repeat this' },
    { role: 'assistant', content: 'Done' },
    { role: 'user', content: 'Repeat this', forkEntryId: 'user-2' },
  ])
})

test('filters compaction entries without a string summary', () => {
  const messages = activeSessionMessages([
    { type: 'message', id: 'user-1', parentId: null, message: { role: 'user', content: 'Hello' } },
    { type: 'compaction', id: 'compact-1', parentId: 'user-1', summary: 42 },
    {
      type: 'message',
      id: 'user-2',
      parentId: 'compact-1',
      message: { role: 'user', content: 'World' },
    },
  ], 'user-2')

  assert.deepEqual(messages, [
    { role: 'user', content: 'Hello' },
    { role: 'user', content: 'World' },
  ])
})

test('retains hidden subagent notifications for status reconciliation', () => {
  const notification = {
    role: 'custom',
    customType: 'subagent-notification',
    content: '',
    display: false,
    details: { id: 'agent-1', status: 'completed' },
  }

  assert.deepEqual(visibleSessionMessages([notification]), [notification])
})

test('keeps visible custom messages out of hidden extension context', () => {
  const visible = { role: 'custom', customType: 'status', content: 'Prêt', display: true }
  const hidden = {
    role: 'custom',
    customType: 'secret-context',
    content: 'Interne',
    display: false,
  }

  assert.deepEqual(
    visibleSessionMessages([
      { role: 'user', content: 'Bonjour' },
      visible,
      hidden,
      { role: 'custom', content: 'Type manquant', display: true },
      { role: 'branchSummary', summary: 'Résumé' },
    ]),
    [
      { role: 'user', content: 'Bonjour' },
      visible,
    ],
  )
})
