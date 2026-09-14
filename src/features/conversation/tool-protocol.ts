import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject } from '../../../shared/types.ts'

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  content: unknown
  isError: boolean
  details?: unknown
}

export interface ToolExecutionUpdate {
  toolCallId: string
  toolName: string
  partialResult: ToolResult
}

export interface ToolCallUpdate {
  call: ToolCall
  contentIndex: number
  delta: string
  phase: 'start' | 'delta' | 'end'
}

export type AgentExecutionStatus = 'running' | 'finished'

export interface ToolExecution extends ToolCall {
  contentIndex?: number
  /** Retains delta-only JSON while public RPC omits partial assistant messages. */
  rawArguments?: string
  partialResult?: ToolResult
  result?: ToolResult
  status: 'generating' | 'running' | 'interrupted'
}

/** Reconciles Agent tool results with later background-completion notifications. */
export function agentStatusesInMessages(
  messages: readonly JsonObject[],
): ReadonlyMap<string, AgentExecutionStatus> {
  const statuses = new Map<string, AgentExecutionStatus>()
  for (const message of messages) {
    if (!isObject(message.details)) continue
    const isAgentResult = message.role === 'toolResult' && message.toolName === 'Agent'
    const isAgentNotification = message.role === 'custom'
      && message.customType === 'subagent-notification'
    if (!isAgentResult && !isAgentNotification) continue
    const agentId = typeof message.details.agentId === 'string'
      ? message.details.agentId
      : typeof message.details.id === 'string'
      ? message.details.id
      : undefined
    const status = agentExecutionStatus(message.details.status)
    if (agentId && status) {
      const previous = statuses.get(agentId)
      // A terminal notification is authoritative even when an older running
      // result appears later in the reconstructed message order.
      if (previous !== 'finished' || status === 'finished') statuses.set(agentId, status)
    }
  }
  return statuses
}

export function agentExecutionStatus(status: unknown): AgentExecutionStatus | undefined {
  if (status === 'background' || status === 'running') return 'running'
  if (
    status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'steered'
  ) return 'finished'
  return undefined
}

/** Extracts every tool call embedded in an assistant message's content array. */
export function toolCallsInMessage(message: JsonObject): ToolCall[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return []

  return message.content.flatMap((part) => {
    const call = toolCallFromValue(part)
    return call ? [call] : []
  })
}

/** Extracts each step of a tool call to track its raw arguments while they are generated. */
export function toolCallInUpdate(event: JsonObject): ToolCallUpdate | null {
  if (event.type !== 'message_update' || !isObject(event.assistantMessageEvent)) return null
  const update = event.assistantMessageEvent
  if (
    update.type !== 'toolcall_start' && update.type !== 'toolcall_delta'
    && update.type !== 'toolcall_end'
  ) return null
  if (!Number.isSafeInteger(update.contentIndex) || (update.contentIndex as number) < 0) return null

  const call = update.type === 'toolcall_end'
    ? toolCallFromValue(update.toolCall)
    : toolCallFromPartial(update.partial, update.contentIndex as number) ?? {
      id: '',
      name: '',
      args: {},
    }
  if (!call) return null

  return {
    call,
    contentIndex: update.contentIndex as number,
    delta: update.type === 'toolcall_delta' && typeof update.delta === 'string' ? update.delta : '',
    phase: update.type === 'toolcall_start'
      ? 'start'
      : update.type === 'toolcall_delta'
      ? 'delta'
      : 'end',
  }
}

/** Applies a streaming step while preserving raw JSON and the call's final identity. */
export function applyToolCallUpdate(
  executions: ToolExecution[],
  update: ToolCallUpdate,
  draftId: string,
): ToolExecution[] {
  if (update.phase === 'start') {
    const previousInterrupted = executions.map((execution) =>
      execution.status === 'generating' && execution.contentIndex === update.contentIndex
        ? { ...execution, status: 'interrupted' as const }
        : execution
    )
    return [...previousInterrupted, {
      ...update.call,
      contentIndex: update.contentIndex,
      id: update.call.id || draftId,
      status: 'generating',
    }]
  }

  let matched = false
  const updated = executions.map((execution) => {
    if (
      matched || execution.status !== 'generating' || execution.contentIndex !== update.contentIndex
    ) return execution
    matched = true
    if (update.phase === 'end') return { ...execution, ...update.call, status: 'running' as const }

    const rawArguments = `${execution.rawArguments ?? ''}${update.delta}`
    const parsedArguments = parseToolArguments(rawArguments)
    return {
      ...execution,
      ...update.call,
      id: update.call.id || execution.id,
      args: parsedArguments ?? update.call.args,
      rawArguments,
    }
  })
  if (matched) return updated

  const rawArguments = update.phase === 'delta' ? update.delta : undefined
  return [...executions, {
    ...update.call,
    args: rawArguments ? parseToolArguments(rawArguments) ?? update.call.args : update.call.args,
    contentIndex: update.contentIndex,
    id: update.call.id || draftId,
    rawArguments,
    status: update.phase === 'end' ? 'running' : 'generating',
  }]
}

/** Freezes calls whose generation produced no end event. */
export function interruptToolCallGeneration(executions: ToolExecution[]): ToolExecution[] {
  return executions.map((execution) =>
    execution.status === 'generating'
      ? { ...execution, status: 'interrupted' }
      : execution
  )
}

/** Extracts a validated tool execution update that carries a partial result from Pi. */
export function toolExecutionUpdateInEvent(event: JsonObject): ToolExecutionUpdate | null {
  if (
    event.type !== 'tool_execution_update' || typeof event.toolCallId !== 'string'
    || typeof event.toolName !== 'string'
  ) return null
  const partial = event.partialResult
  if (!isObject(partial)) return null
  return {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    partialResult: {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      content: partial.content,
      isError: false,
      details: isObject(partial.details) ? partial.details : undefined,
    },
  }
}

/** Replaces the matching execution's partial result without touching executions that are already settled. */
export function applyToolExecutionUpdate(
  executions: ToolExecution[],
  update: ToolExecutionUpdate,
): ToolExecution[] {
  return executions.map((execution) => {
    if (execution.id !== update.toolCallId || execution.status !== 'running' || execution.result)
      return execution
    return { ...execution, partialResult: update.partialResult }
  })
}

/** Picks out a validated tool result from a toolResult message, or returns null. */
export function toolResultInMessage(message: JsonObject): ToolResult | null {
  if (
    message.role !== 'toolResult' || typeof message.toolCallId !== 'string'
    || typeof message.toolName !== 'string'
  ) return null
  return {
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.content,
    isError: message.isError === true,
    details: message.details,
  }
}

export function isToolCallPending(result: ToolResult | undefined): boolean {
  return result === undefined
}

/** Flattens arbitrary tool output into a single string, handling nested content arrays. */
export function toolContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (isObject(content) && 'content' in content) return toolContentText(content.content)
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
    )
    .join('\n')
}

function toolCallFromValue(value: unknown): ToolCall | null {
  if (
    !isObject(value) || value.type !== 'toolCall' || typeof value.id !== 'string'
    || typeof value.name !== 'string'
  ) return null
  return { id: value.id, name: value.name, args: value.arguments }
}

function toolCallFromPartial(value: unknown, contentIndex: number): ToolCall | null {
  if (!isObject(value) || !Array.isArray(value.content)) return null
  return toolCallFromValue(value.content[contentIndex])
}

function parseToolArguments(value: string): unknown | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
