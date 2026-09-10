import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatToolData,
  stripScripts,
  toolWriteContent,
} from '../src/features/conversation/tool-presentation.ts'
import {
  agentStatusesInMessages,
  applyToolCallUpdate,
  applyToolExecutionUpdate,
  interruptToolCallGeneration,
  isToolCallPending,
  toolCallInUpdate,
  toolCallsInMessage,
  toolContentText,
  toolExecutionUpdateInEvent,
  toolResultInMessage,
  type ToolExecution,
} from '../src/features/conversation/tool-protocol.ts'

test('reconciles running Agent results with completion notifications', () => {
  const statuses = agentStatusesInMessages([
    {
      role: 'toolResult',
      toolName: 'Agent',
      details: { agentId: 'agent-1', status: 'background' },
    },
    {
      role: 'custom',
      customType: 'subagent-notification',
      details: { id: 'agent-1', status: 'completed' },
    },
    {
      role: 'toolResult',
      toolName: 'Agent',
      details: { agentId: 'agent-2', status: 'running' },
    },
    {
      role: 'toolResult',
      toolName: 'Agent',
      details: { agentId: 'agent-3', status: 'steered' },
    },
  ])

  assert.equal(statuses.get('agent-1'), 'finished')
  assert.equal(statuses.get('agent-2'), 'running')
  assert.equal(statuses.get('agent-3'), 'finished')
})

test('extracts tool calls and their resolved result from Pi messages', () => {
  const calls = toolCallsInMessage({
    role: 'assistant',
    content: [
      { type: 'text', text: 'Je regarde.' },
      { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'src/App.tsx' } },
    ],
  })
  const result = toolResultInMessage({
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'read',
    content: [{ type: 'text', text: 'import App' }],
    isError: false,
  })

  assert.deepEqual(calls, [{ id: 'call_1', name: 'read', args: { path: 'src/App.tsx' } }])
  assert.deepEqual(result, {
    toolCallId: 'call_1',
    toolName: 'read',
    content: [{ type: 'text', text: 'import App' }],
    isError: false,
    details: undefined,
  })
  assert.equal(toolContentText(result?.content), 'import App')
})

test('tracks raw tool arguments from generation start to completion', () => {
  const partialCall = {
    type: 'toolCall',
    id: 'call_1',
    name: 'read',
    arguments: { path: 'src/App' },
  }
  const start = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex: 1,
      partial: { content: [{ type: 'text' }, partialCall] },
    },
  })
  const delta = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_delta',
      contentIndex: 1,
      delta: '{"path":"src/App',
      partial: { content: [{ type: 'text' }, partialCall] },
    },
  })
  const end = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: {
        type: 'toolCall',
        id: 'call_1',
        name: 'read',
        arguments: { path: 'src/App.tsx' },
      },
    },
  })

  assert.deepEqual(start, {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App' } },
    contentIndex: 1,
    delta: '',
    phase: 'start',
  })
  assert.deepEqual(delta, {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App' } },
    contentIndex: 1,
    delta: '{"path":"src/App',
    phase: 'delta',
  })
  assert.deepEqual(end, {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App.tsx' } },
    contentIndex: 1,
    delta: '',
    phase: 'end',
  })
  assert.equal(
    toolCallInUpdate({ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } }),
    null,
  )
})

test('accepts delta-only tool calls before execution starts', () => {
  const start = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
  })
  const firstDelta = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: '{"path":"src/App',
    },
  })
  const secondDelta = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: '.tsx"}',
    },
  })

  assert.deepEqual(start?.call, { id: '', name: '', args: {} })
  const executions = applyToolCallUpdate(
    applyToolCallUpdate(
      applyToolCallUpdate([], start!, 'draft_1'),
      firstDelta!,
      'unused',
    ),
    secondDelta!,
    'unused',
  )

  assert.equal(executions[0]?.status, 'generating')
  assert.equal(executions[0]?.rawArguments, '{"path":"src/App.tsx"}')
  assert.deepEqual(executions[0]?.args, { path: 'src/App.tsx' })
})

test('accumulates arguments and preserves interrupted generations', () => {
  const start = {
    call: { id: '', name: 'write', args: {} },
    contentIndex: 0,
    delta: '',
    phase: 'start' as const,
  }
  const delta = {
    call: { id: 'call_1', name: 'write', args: { path: 'note' } },
    contentIndex: 0,
    delta: '{"path":"note',
    phase: 'delta' as const,
  }
  const executions = applyToolCallUpdate(applyToolCallUpdate([], start, 'draft_1'), delta, 'unused')

  assert.deepEqual(executions, [{
    id: 'call_1',
    name: 'write',
    args: { path: 'note' },
    contentIndex: 0,
    rawArguments: '{"path":"note',
    status: 'generating',
  }])
  assert.equal(interruptToolCallGeneration(executions)[0]?.status, 'interrupted')

  const completed = applyToolCallUpdate(executions, {
    call: { id: 'call_1', name: 'write', args: { path: 'note.md' } },
    contentIndex: 0,
    delta: '',
    phase: 'end',
  }, 'unused')
  assert.equal(completed[0]?.status, 'running')
  assert.deepEqual(completed[0]?.args, { path: 'note.md' })
})

test('preserves partial arguments through multiple deltas', () => {
  const start = {
    call: { id: '', name: 'read', args: {} },
    contentIndex: 0,
    delta: '',
    phase: 'start' as const,
  }
  const first = applyToolCallUpdate(applyToolCallUpdate([], start, 'draft_1'), {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App' } },
    contentIndex: 0,
    delta: '{"path":"src/App',
    phase: 'delta',
  }, 'unused')
  const second = applyToolCallUpdate(first, {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App.tsx' } },
    contentIndex: 0,
    delta: '.tsx"}',
    phase: 'delta',
  }, 'unused')

  assert.equal(second[0]?.status, 'generating')
  assert.deepEqual(second[0]?.args, { path: 'src/App.tsx' })
})

test('marks a tool call as pending until its result arrives', () => {
  assert.equal(isToolCallPending(undefined), true)
  assert.equal(
    isToolCallPending({ toolCallId: 'call_1', toolName: 'read', content: '', isError: false }),
    false,
  )
})

test('ignores non-tool content and formats tool arguments safely', () => {
  assert.deepEqual(
    toolCallsInMessage({ role: 'assistant', content: [{ type: 'text', text: 'Bonjour' }] }),
    [],
  )
  assert.equal(toolResultInMessage({ role: 'user', content: 'Bonjour' }), null)
  assert.equal(formatToolData({ command: 'pwd' }), '{\n  "command": "pwd"\n}')
})

test('carries details from Pi tool result messages in history', () => {
  const result = toolResultInMessage({
    role: 'toolResult',
    toolCallId: 'edit_1',
    toolName: 'edit',
    content: 'Successfully replaced 1 block(s).',
    isError: false,
    details: { diff: '+1 added', firstChangedLine: 1 },
  })
  assert.deepEqual(result, {
    toolCallId: 'edit_1',
    toolName: 'edit',
    content: 'Successfully replaced 1 block(s).',
    isError: false,
    details: { diff: '+1 added', firstChangedLine: 1 },
  })
})

test('extracts validated tool_execution_update events and rejects malformed ones', () => {
  assert.equal(toolExecutionUpdateInEvent({ type: 'other' }), null)
  assert.equal(toolExecutionUpdateInEvent({ type: 'tool_execution_update' }), null)
  assert.equal(
    toolExecutionUpdateInEvent({
      type: 'tool_execution_update',
      toolCallId: 'call_1',
      toolName: 'bash',
      partialResult: null,
    }),
    null,
  )

  const update = toolExecutionUpdateInEvent({
    type: 'tool_execution_update',
    toolCallId: 'call_1',
    toolName: 'bash',
    partialResult: { content: [{ type: 'text', text: 'line 1' }], details: { truncation: null } },
  })
  assert.equal(update?.toolCallId, 'call_1')
  assert.equal(update?.toolName, 'bash')
  assert.equal(toolContentText(update?.partialResult.content), 'line 1')
  assert.deepEqual(update?.partialResult.details, { truncation: null })
  assert.equal(
    toolExecutionUpdateInEvent({
      type: 'tool_execution_update',
      toolCallId: 'call_1',
      toolName: 'bash',
      partialResult: 'not an object',
    }),
    null,
  )
})

test('replaces partial results for matching running executions', () => {
  const execution: ToolExecution = {
    id: 'call_1',
    name: 'bash',
    args: { command: 'ls' },
    status: 'running',
  }
  const executions = [{ ...execution }]

  const first = applyToolExecutionUpdate(executions, {
    toolCallId: 'call_1',
    toolName: 'bash',
    partialResult: { toolCallId: 'call_1', toolName: 'bash', content: 'a', isError: false },
  })
  assert.equal(toolContentText(first[0]?.partialResult?.content), 'a')

  const second = applyToolExecutionUpdate(first, {
    toolCallId: 'call_1',
    toolName: 'bash',
    partialResult: { toolCallId: 'call_1', toolName: 'bash', content: 'ab', isError: false },
  })
  assert.equal(toolContentText(second[0]?.partialResult?.content), 'ab')
})

test('does not touch executions that are not running', () => {
  const settled: ToolExecution = {
    id: 'call_1',
    name: 'bash',
    args: {},
    result: { toolCallId: 'call_1', toolName: 'bash', content: 'done', isError: false },
    status: 'running',
  }
  const updated = applyToolExecutionUpdate([settled], {
    toolCallId: 'call_1',
    toolName: 'bash',
    partialResult: { toolCallId: 'call_1', toolName: 'bash', content: 'partial', isError: false },
  })
  assert.equal(toolContentText(updated[0]?.result?.content), 'done')
  assert.equal(updated[0]?.partialResult, undefined)
})

test('extracts write tool content and rejects non-string arguments', () => {
  assert.equal(
    toolWriteContent({ content: 'Hello', path: 'note.md' }),
    'Hello',
  )
  assert.equal(toolWriteContent({ content: 'multiline\ntext', path: 'a' }), 'multiline\ntext')
  assert.equal(toolWriteContent(null), null)
  assert.equal(toolWriteContent({}), null)
  assert.equal(toolWriteContent({ path: 'a' }), null)
  assert.equal(toolWriteContent({ content: '' }), null)
  assert.equal(toolWriteContent({ content: 42 }), null)
})

test('strips executable HTML from the inline preview', () => {
  assert.equal(
    stripScripts(
      '<button onclick="run()">Open</button><script>run()</script>'
        + '<script src="app.js"></script><a href="javascript:run()">Run</a>'
        + '<img onerror=run() src="image.png">',
    ),
    '<button>Open</button><a>Run</a><img src="image.png">',
  )
})
