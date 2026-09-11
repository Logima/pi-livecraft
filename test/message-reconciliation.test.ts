import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assistantTurnParts,
  conversationMessageEntries,
  sameAssistantMessage,
  sameMessage,
} from '../src/features/conversation/message-reconciliation.ts'

test('keeps each streamed assistant message before its tool calls', () => {
  const turns = [
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Inspecting' }, {
        type: 'toolCall',
        id: 'call_1',
        name: 'read',
        arguments: { path: 'one' },
      }],
    },
    {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Checking' }, {
        type: 'toolCall',
        id: 'call_2',
        name: 'read',
        arguments: { path: 'two' },
      }],
    },
  ]

  assert.deepEqual(
    turns.flatMap((message) => assistantTurnParts(message).map((part) => part.kind)),
    ['message', 'tool', 'message', 'tool'],
  )
})

test('reconciles completed messages without collapsing distinct live turns', () => {
  const completed = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'done' }] }
  const different = {
    role: 'assistant',
    timestamp: 10,
    content: [{ type: 'text', text: 'still working' }],
  }
  const live = [
    { id: 'completed-1', message: completed },
    { id: 'different', message: different },
    { id: 'completed-2', message: completed },
  ]

  assert.equal(sameAssistantMessage(completed, different), false)
  assert.deepEqual(
    conversationMessageEntries([completed], live).map(({ key, source }) => ({ key, source })),
    [
      { key: 'completed-1', source: 'history' },
      { key: 'different', source: 'live' },
      { key: 'completed-2', source: 'live' },
    ],
  )
})

test('indexes repeated message content without reusing a streamed identity', () => {
  const message = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'same' }] }
  const live = [{ id: 'live-1', message }, { id: 'live-2', message }]

  assert.deepEqual(
    conversationMessageEntries([message, message], live).map(({ key, source }) => ({
      key,
      source,
    })),
    [
      { key: 'live-1', source: 'history' },
      { key: 'live-2', source: 'history' },
    ],
  )
})

test('preserves streamed identities when messages move into history', () => {
  const first = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'first' }] }
  const second = { role: 'assistant', timestamp: 11, content: [{ type: 'text', text: 'second' }] }
  const live = [{ id: 'live-1', message: first }, { id: 'live-2', message: second }]

  assert.deepEqual(
    conversationMessageEntries([first], live).map(({ key, source }) => ({ key, source })),
    [
      { key: 'live-1', source: 'history' },
      { key: 'live-2', source: 'live' },
    ],
  )
  assert.deepEqual(
    conversationMessageEntries([first, second], live).map(({ key, source }) => ({ key, source })),
    [
      { key: 'live-1', source: 'history' },
      { key: 'live-2', source: 'history' },
    ],
  )
})

test('matches identical user messages by text content', () => {
  assert.equal(
    sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'user', content: 'Bonjour' }),
    true,
  )
  assert.equal(
    sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'user', content: 'Salut' }),
    false,
  )
  assert.equal(
    sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Bonjour' }),
    false,
  )
  assert.equal(sameMessage({ role: 'user' }, { role: 'user' }), false)
})

test('matches user messages when Pi returns content as an array', () => {
  assert.equal(
    sameMessage(
      { role: 'user', content: 'Salut' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Salut' }, {
          type: 'image',
          data: '...',
          mimeType: 'image/png',
        }],
      },
    ),
    true,
  )
})

test('reconciles an optimistic user message with its history counterpart', () => {
  const history = [
    { role: 'user', timestamp: 100, content: 'Bonjour' },
    { role: 'assistant', timestamp: 101, content: 'Réponse' },
  ]
  const live = [{ id: 'opt-1', message: { role: 'user', content: 'Bonjour' } }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key, source }) => ({ key, source })), [
    { key: 'opt-1', source: 'history' },
    { key: 'history-101-1', source: 'history' },
  ])
})

test('keeps an unmatched optimistic user message as a live entry', () => {
  const history = [{ role: 'assistant', content: 'Précédent' }]
  const live = [{ id: 'opt-1', message: { role: 'user', content: 'En attente' } }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key, source }) => ({ key, source })), [
    { key: 'history--0', source: 'history' },
    { key: 'opt-1', source: 'live' },
  ])
})

test('keeps anchored live output before history that arrives later', () => {
  const history = [
    { role: 'user', content: 'Before' },
    { role: 'assistant', content: 'After' },
  ]
  const live = [{
    id: 'notice-1',
    historyIndex: 1,
    message: { role: 'custom', customType: 'pi-notification', content: 'Output' },
  }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key }) => key), [
    'history--0',
    'notice-1',
    'history--1',
  ])
})
