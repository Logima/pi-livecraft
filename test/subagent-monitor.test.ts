import assert from 'node:assert/strict'
import test from 'node:test'
import type { JsonObject } from '../shared/types.ts'
import {
  formatAgentTokens,
  formatSubagentDuration,
  formatSubagentModelConfig,
  projectSubagentMonitor,
  subagentRelationForRow,
  subagentStopPrompt,
  type SubagentMonitorRow,
} from '../src/features/conversation/subagent-monitor.ts'
import type { ToolExecution } from '../src/features/conversation/tool-protocol.ts'
import type { SubagentBridgeSnapshot } from '../src/features/conversation/subagent-bridge.ts'

function assistantCall(
  id: string,
  args: JsonObject,
): JsonObject {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'Agent', arguments: args }],
  }
}

function agentResult(
  toolCallId: string,
  details: JsonObject,
  isError = false,
): JsonObject {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'Agent',
    content: '',
    isError,
    details,
  }
}

function rowById(rows: readonly SubagentMonitorRow[], agentId: string): SubagentMonitorRow {
  const row = rows.find((candidate) => candidate.agentId === agentId)
  assert.ok(row)
  return row
}

test('formats monitor duration at whole-second precision', () => {
  assert.equal(formatSubagentDuration(4_000), '4s')
  assert.equal(formatSubagentDuration(64_000), '1min 4s')
  assert.equal(formatSubagentDuration(3_784_000), '1h 3min 4s')
  assert.equal(formatSubagentDuration(499), '0s')
  assert.equal(formatSubagentDuration(500), '1s')
  assert.equal(formatSubagentDuration(59_500), '1min')
})

test('builds live relation metadata and the private stop prompt', () => {
  assert.deepEqual(
    subagentRelationForRow('parent-1', {
      agentId: 'agent-1',
      childSessionId: 'child-1',
      status: 'running',
    }),
    {
      parentManagerSessionId: 'parent-1',
      agentId: 'agent-1',
      childSessionId: 'child-1',
    },
  )
  assert.equal(
    subagentRelationForRow('parent-1', {
      agentId: 'agent-1',
      childSessionId: 'child-1',
      status: 'completed',
    }),
    undefined,
  )
  assert.equal(subagentStopPrompt('agent-1'), '/livecraft-stop-subagent agent-1')
})

test('prefers the effective model in compact configuration', () => {
  assert.deepEqual(
    formatSubagentModelConfig({
      model: 'luna',
      effectiveModel: { provider: 'openai', modelId: 'gpt-5.6-luna' },
      thinking: 'xhigh',
      effort: 'xhigh',
    }),
    {
      ariaLabel: 'Model openai/gpt-5.6-luna, Requested thinking xhigh',
      text: 'GPT 5.6 Luna xhigh',
    },
  )
})

test('uses requested model wording for transcript-only configuration', () => {
  assert.deepEqual(
    formatSubagentModelConfig({
      model: 'gpt-5.6-luna',
      thinking: 'high',
      effort: 'high',
    }),
    {
      ariaLabel: 'Requested model gpt-5.6-luna, Requested thinking high',
      text: 'GPT 5.6 Luna high',
    },
  )
})

test('formats input/output tokens and preserves scalar totals', () => {
  assert.deepEqual(formatAgentTokens({ input: 150_000, output: 2_000, cacheWrite: 400 }), {
    ariaLabel: 'Input 150k tokens, output 2k tokens',
    text: '↘ 150k · ↗ 2k',
  })
  assert.deepEqual(formatAgentTokens(42), {
    ariaLabel: 'Total 42 tokens',
    text: '42 tokens',
  })
})

test('projects concurrent Agent calls into active rows', () => {
  const view = projectSubagentMonitor([
    assistantCall('call-a', {
      taskId: 'agent-a',
      description: 'Inspect API',
      subagent_type: 'Explore',
      model: { provider: 'openai', modelId: 'gpt-5' },
      thinking: 'medium',
      effort: 'high',
    }),
    assistantCall('call-b', { taskId: 'agent-b', description: 'Check tests' }),
    agentResult('call-a', { agentId: 'agent-a', status: 'background' }),
    agentResult('call-b', { agentId: 'agent-b', status: 'running' }),
  ])

  assert.deepEqual(view.history, [])
  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-a', 'agent-b'])
  assert.deepEqual(rowById(view.active, 'agent-a'), {
    agentId: 'agent-a',
    description: 'Inspect API',
    subagentType: 'Explore',
    model: { provider: 'openai', modelId: 'gpt-5' },
    thinking: 'medium',
    effort: 'high',
    status: 'running',
  })
})

test('reconciles a running result with its completion notification', () => {
  const view = projectSubagentMonitor([
    agentResult('call-a', {
      agentId: 'agent-a',
      status: 'background',
      durationMs: 1200,
    }),
    {
      role: 'custom',
      customType: 'subagent-notification',
      details: { id: 'agent-a', status: 'completed', toolCount: 3, tokens: 42 },
    },
  ])

  assert.deepEqual(view.active, [])
  assert.deepEqual(rowById(view.history, 'agent-a'), {
    agentId: 'agent-a',
    status: 'completed',
    durationMs: 1200,
    toolCount: 3,
    tokens: 42,
  })
})

test('lets a parent completion notification win over a stale live execution result', () => {
  const view = projectSubagentMonitor([
    {
      role: 'custom',
      customType: 'subagent-notification',
      details: { id: 'agent-a', status: 'completed' },
    },
  ], [{
    id: 'call-a',
    name: 'Agent',
    args: { agentId: 'agent-a' },
    status: 'running',
    result: {
      toolCallId: 'call-a',
      toolName: 'Agent',
      content: '',
      isError: false,
      details: { agentId: 'agent-a', status: 'background' },
    },
  }])

  assert.deepEqual(rowById(view.history, 'agent-a').status, 'completed')
})

test('preserves failed and cancelled lifecycle values when explicitly represented', () => {
  const view = projectSubagentMonitor([
    agentResult('call-failed', { agentId: 'failed', status: 'background' }, true),
    agentResult('call-cancelled', { agentId: 'cancelled', status: 'cancelled' }),
  ])

  assert.equal(rowById(view.history, 'failed').status, 'failed')
  assert.equal(rowById(view.history, 'cancelled').status, 'cancelled')
})

test('omits unsupported or missing telemetry', () => {
  const view = projectSubagentMonitor([
    assistantCall('call-a', {
      task_id: 'agent-a',
      description: 'No telemetry',
      subagentType: 'worker',
    }),
    agentResult('call-a', { task_id: 'agent-a', status: 'running' }),
  ])

  assert.deepEqual(rowById(view.active, 'agent-a'), {
    agentId: 'agent-a',
    description: 'No telemetry',
    subagentType: 'worker',
    status: 'running',
  })
})

test('reuses the same row when an Agent run resumes with the same ID', () => {
  const view = projectSubagentMonitor([
    assistantCall('call-a', { agentId: 'agent-a', description: 'First run' }),
    agentResult('call-a', { agentId: 'agent-a', status: 'completed' }),
    assistantCall('call-b', { agentId: 'agent-a', description: 'Resumed run' }),
  ])

  assert.equal(view.history.length, 0)
  assert.deepEqual(view.active, [{
    agentId: 'agent-a',
    description: 'Resumed run',
    status: 'running',
  }])
})

test('reload-shaped exact bridge correlation promotes one real row', () => {
  const view = projectSubagentMonitor(
    [],
    [{
      id: 'call-foreground',
      name: 'Agent',
      args: { description: 'Inspect API', subagent_type: 'Explore' },
      status: 'running',
    }],
    {
      schemaVersion: 1,
      agents: [{
        agentId: 'agent-foreground',
        toolCallId: 'call-foreground',
        childSessionId: 'child-foreground',
        type: 'Explore',
        description: 'Inspect API',
        status: 'running',
        startedAt: 100,
        model: { provider: 'openai', modelId: 'gpt-5' },
        requestedModel: 'gpt-5',
        thinking: 'xhigh',
        requestedThinking: 'xhigh',
        latestActivity: 'grep',
        toolUses: 3,
        turnCount: 2,
        tokens: { input: 10, output: 20, cacheWrite: 2 },
      }],
    },
    250,
  )

  assert.equal(view.active.length, 1)
  assert.deepEqual(view.active[0], {
    agentId: 'agent-foreground',
    toolCallId: 'call-foreground',
    childSessionId: 'child-foreground',
    description: 'Inspect API',
    subagentType: 'Explore',
    status: 'running',
    startedAt: 100,
    completedAt: undefined,
    effectiveModel: { provider: 'openai', modelId: 'gpt-5' },
    model: 'gpt-5',
    thinking: 'xhigh',
    latestActivity: 'grep',
    toolCount: 3,
    tokens: { input: 10, output: 20, cacheWrite: 2 },
    durationMs: 150,
  })
  assert.equal(view.active.some((row) => row.provisional), false)
  assert.equal(view.history.length, 0)
})

test('bridge running duration overrides fallback telemetry with elapsed time', () => {
  const view = projectSubagentMonitor(
    [agentResult('call-live', {
      agentId: 'agent-live',
      status: 'background',
      durationMs: 0,
    })],
    [],
    {
      schemaVersion: 1,
      agents: [{
        agentId: 'agent-live',
        childSessionId: 'child-live',
        type: 'Explore',
        description: 'Live task',
        status: 'running',
        startedAt: 100,
        toolUses: 0,
        turnCount: 1,
        tokens: { input: 0, output: 0, cacheWrite: 0 },
      }],
    },
    275,
  )

  assert.equal(rowById(view.active, 'agent-live').durationMs, 175)
})

test('bridge terminal duration uses completion timestamps', () => {
  const view = projectSubagentMonitor(
    [],
    [],
    {
      schemaVersion: 1,
      agents: [{
        agentId: 'agent-done',
        type: 'Explore',
        description: 'Finished task',
        status: 'completed',
        startedAt: 100,
        completedAt: 340,
        toolUses: 1,
        turnCount: 1,
        tokens: { input: 1, output: 2, cacheWrite: 0 },
      }],
    },
    1_000,
  )

  assert.equal(rowById(view.history, 'agent-done').durationMs, 240)
})

test('bridge durations clamp negative elapsed time to zero', () => {
  const view = projectSubagentMonitor(
    [],
    [],
    {
      schemaVersion: 1,
      agents: [
        {
          agentId: 'agent-running',
          type: 'Explore',
          description: 'Running task',
          status: 'running',
          startedAt: 500,
          toolUses: 0,
          turnCount: 1,
          tokens: { input: 0, output: 0, cacheWrite: 0 },
        },
        {
          agentId: 'agent-done',
          type: 'Explore',
          description: 'Finished task',
          status: 'completed',
          startedAt: 500,
          completedAt: 400,
          toolUses: 0,
          turnCount: 1,
          tokens: { input: 0, output: 0, cacheWrite: 0 },
        },
      ],
    },
    400,
  )

  assert.equal(rowById(view.active, 'agent-running').durationMs, 0)
  assert.equal(rowById(view.history, 'agent-done').durationMs, 0)
})

test('uses bridge lifecycle and telemetry without parent notifications', () => {
  const bridge: SubagentBridgeSnapshot = {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-live',
      childSessionId: 'child-live',
      type: 'Explore',
      description: 'Live task',
      status: 'completed',
      startedAt: 100,
      completedAt: 200,
      toolUses: 4,
      turnCount: 2,
      latestActivity: 'read',
      tokens: { input: 10, output: 20, cacheWrite: 2 },
    }],
  }
  const view = projectSubagentMonitor(
    [
      assistantCall('call-live', { agentId: 'agent-live', description: 'Live task' }),
    ],
    [],
    bridge,
  )

  const row = rowById(view.history, 'agent-live')
  assert.equal(row.status, 'completed')
  assert.equal(row.childSessionId, 'child-live')
  assert.equal(row.durationMs, 100)
  assert.equal(row.toolCount, 4)
  assert.deepEqual(row.tokens, { input: 10, output: 20, cacheWrite: 2 })
})

test('marks a transcript-only running row interrupted when an empty bridge snapshot is valid', () => {
  const view = projectSubagentMonitor(
    [
      assistantCall('call-a', { agentId: 'agent-a', description: 'Interrupted task' }),
      agentResult('call-a', { agentId: 'agent-a', status: 'running' }),
    ],
    [],
    { schemaVersion: 1, agents: [] },
  )

  assert.deepEqual(view.active, [])
  assert.equal(rowById(view.history, 'agent-a').status, 'interrupted')
})

test('keeps a transcript-only running row active without a bridge snapshot', () => {
  const view = projectSubagentMonitor([
    assistantCall('call-a', { agentId: 'agent-a', description: 'Still running' }),
    agentResult('call-a', { agentId: 'agent-a', status: 'running' }),
  ])

  assert.equal(rowById(view.active, 'agent-a').status, 'running')
  assert.deepEqual(view.history, [])
})

test('preserves a transcript-only completed row with an empty bridge snapshot', () => {
  const view = projectSubagentMonitor(
    [
      agentResult('call-a', { agentId: 'agent-a', status: 'completed' }),
    ],
    [],
    { schemaVersion: 1, agents: [] },
  )

  assert.equal(rowById(view.history, 'agent-a').status, 'completed')
  assert.deepEqual(view.active, [])
})

test('bridge terminal status wins over stale parent running evidence', () => {
  const bridge: SubagentBridgeSnapshot = {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-live',
      childSessionId: 'child-live',
      type: 'Explore',
      description: 'Live task',
      status: 'failed',
      startedAt: 100,
      completedAt: 250,
      toolUses: 1,
      turnCount: 1,
      tokens: { input: 1, output: 2, cacheWrite: 0 },
    }],
  }
  const view = projectSubagentMonitor([], [{
    id: 'call-live',
    name: 'Agent',
    args: { agentId: 'agent-live' },
    status: 'running',
    result: {
      toolCallId: 'call-live',
      toolName: 'Agent',
      content: '',
      isError: false,
      details: { agentId: 'agent-live', status: 'background' },
    },
  }], bridge)
  assert.equal(rowById(view.history, 'agent-live').status, 'failed')
})

test('uses live Agent execution state and keeps the view hidden without agents', () => {
  const execution: ToolExecution = {
    id: 'call-live',
    name: 'Agent',
    args: { agentId: 'agent-live', description: 'Live task' },
    status: 'running',
  }
  const view = projectSubagentMonitor([], [execution])

  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-live'])
  assert.deepEqual(projectSubagentMonitor([], []), { active: [], history: [] })
})

test('shows a stable non-navigable provisional row for a foreground Agent call', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-foreground',
    name: 'Agent',
    args: {
      description: 'Complete relay backend boundary',
      subagent_type: 'general-purpose',
      model: 'gpt-5',
    },
    status: 'running',
  }])

  assert.deepEqual(view.active, [{
    agentId: 'provisional:call-foreground',
    toolCallId: 'call-foreground',
    description: 'Complete relay backend boundary',
    subagentType: 'general-purpose',
    model: 'gpt-5',
    status: 'running',
    provisional: true,
  }])
})

test('promotes an empty provisional row when it is the only running agent', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-foreground',
    name: 'Agent',
    args: {},
    status: 'running',
  }], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      childSessionId: 'child-real',
      type: 'general-purpose',
      description: 'Inspect the build',
      status: 'running',
      startedAt: 100,
      toolUses: 2,
      turnCount: 1,
      tokens: { input: 3, output: 4, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-real'])
  assert.equal(view.active[0]?.provisional, undefined)
  assert.equal(view.active[0]?.childSessionId, 'child-real')
})

test('promotes the provisional row by exact toolCallId', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-foreground',
    name: 'Agent',
    args: {
      description: 'Complete relay backend boundary',
      subagent_type: 'general-purpose',
      model: 'gpt-5',
    },
    status: 'running',
  }], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      toolCallId: 'call-foreground',
      childSessionId: 'child-real',
      type: 'general-purpose',
      description: 'Complete relay backend boundary',
      status: 'running',
      startedAt: 100,
      requestedModel: 'gpt-5',
      toolUses: 0,
      turnCount: 1,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-real'])
  assert.equal(view.active[0]?.provisional, undefined)
  assert.equal(view.active[0]?.childSessionId, 'child-real')
})

test('promotes a foreground bridge row through unique identity correlation', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-foreground',
    name: 'Agent',
    args: {
      description: 'Complete relay backend boundary',
      subagent_type: 'general-purpose',
      model: 'gpt-5',
      thinking: 'medium',
    },
    status: 'running',
  }], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      childSessionId: 'child-real',
      type: 'general-purpose',
      description: 'Complete relay backend boundary',
      status: 'running',
      startedAt: 100,
      requestedModel: 'gpt-5',
      requestedThinking: 'medium',
      toolUses: 2,
      turnCount: 1,
      tokens: { input: 3, output: 4, cacheWrite: 0 },
    }],
  }, 500)

  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-real'])
  assert.equal(view.active[0]?.provisional, undefined)
  assert.equal(view.active[0]?.toolCallId, 'call-foreground')
  assert.equal(view.active[0]?.childSessionId, 'child-real')
  assert.equal(view.active[0]?.toolCount, 2)
  assert.equal(view.active[0]?.durationMs, 400)
})

test('keeps same-description calls distinct when only one toolCallId matches', () => {
  const execution = (id: string): ToolExecution => ({
    id,
    name: 'Agent',
    args: { description: 'Same task', subagent_type: 'general-purpose' },
    status: 'running',
  })
  const view = projectSubagentMonitor([], [execution('call-a'), execution('call-b')], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      toolCallId: 'call-b',
      childSessionId: 'child-real',
      type: 'general-purpose',
      description: 'Same task',
      status: 'running',
      startedAt: 100,
      toolUses: 0,
      turnCount: 1,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), [
    'provisional:call-a',
    'agent-real',
  ])
  assert.equal(view.active.filter(({ provisional }) => provisional).length, 1)
  assert.equal(view.active.filter(({ agentId }) => agentId === 'agent-real').length, 1)
  assert.equal(view.active.filter(({ toolCallId }) => toolCallId === 'call-b').length, 1)
})

test('excludes a settled ID-less failed call from fallback uniqueness', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-failed-resume',
    name: 'Agent',
    args: { description: 'Same task', subagent_type: 'general-purpose' },
    status: 'running',
    result: {
      toolCallId: 'call-failed-resume',
      toolName: 'Agent',
      content: 'resume failed',
      isError: true,
    },
  }, {
    id: 'call-live',
    name: 'Agent',
    args: { description: 'Same task', subagent_type: 'general-purpose' },
    status: 'running',
  }], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      childSessionId: 'child-real',
      type: 'general-purpose',
      description: 'Same task',
      status: 'running',
      startedAt: 100,
      toolUses: 0,
      turnCount: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-real'])
})

test('does not create a provisional row for a settled Agent error without an agent ID', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-failed-resume',
    name: 'Agent',
    args: { description: 'Same task', subagent_type: 'general-purpose' },
    status: 'running',
    result: {
      toolCallId: 'call-failed-resume',
      toolName: 'Agent',
      content: 'resume failed',
      isError: true,
    },
  }])

  assert.deepEqual(view, { active: [], history: [] })
})

test('leaves identical simultaneous ID-less calls unmapped', () => {
  const execution = (id: string): ToolExecution => ({
    id,
    name: 'Agent',
    args: { description: 'Same task', subagent_type: 'general-purpose' },
    status: 'running',
  })
  const view = projectSubagentMonitor([], [execution('call-a'), execution('call-b')], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-a',
      childSessionId: 'child-a',
      type: 'general-purpose',
      description: 'Same task',
      status: 'running',
      startedAt: 100,
      toolUses: 0,
      turnCount: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }, {
      agentId: 'agent-b',
      childSessionId: 'child-b',
      type: 'general-purpose',
      description: 'Same task',
      status: 'running',
      startedAt: 200,
      toolUses: 0,
      turnCount: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), [
    'provisional:call-a',
    'provisional:call-b',
    'agent-a',
    'agent-b',
  ])
  assert.equal(view.active.filter(({ provisional }) => provisional).length, 2)
})

test('does not fallback when requested model or thinking differs', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-foreground',
    name: 'Agent',
    args: {
      description: 'Same task',
      subagent_type: 'general-purpose',
      model: 'gpt-5',
      thinking: 'high',
    },
    status: 'running',
  }], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      type: 'general-purpose',
      description: 'Same task',
      status: 'running',
      startedAt: 100,
      requestedModel: 'gpt-4',
      requestedThinking: 'medium',
      toolUses: 0,
      turnCount: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), [
    'provisional:call-foreground',
    'agent-real',
  ])
})

test('does not retain stale provisional evidence after its tool execution stops', () => {
  const view = projectSubagentMonitor([], [{
    id: 'call-stale',
    name: 'Agent',
    args: { description: 'Same task', subagent_type: 'general-purpose' },
    status: 'interrupted',
  }], {
    schemaVersion: 1,
    agents: [{
      agentId: 'agent-real',
      toolCallId: 'call-other',
      childSessionId: 'child-real',
      type: 'general-purpose',
      description: 'Same task',
      status: 'running',
      startedAt: 100,
      toolUses: 0,
      turnCount: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0 },
    }],
  })

  assert.deepEqual(view.active.map(({ agentId }) => agentId), ['agent-real'])
})
