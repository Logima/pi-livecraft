import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject } from '../../../shared/types.ts'
import { toolCallsInMessage, type ToolCall } from './tool-protocol.ts'

export type AssistantTurnPart = { kind: 'message'; message: JsonObject } | {
  kind: 'tool'
  call: ToolCall
}

export interface LiveMessage {
  id: string
  message: JsonObject
  /** Number of history messages already rendered when this live message was created. */
  historyIndex?: number
}

export type ConversationMessageEntry =
  | { key: string; message: JsonObject; source: 'history'; historyIndex: number }
  | { key: string; message: JsonObject; source: 'live' }

/** Matches assistant messages by role, timestamp when available, and serialized content. */
export function sameAssistantMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false
  if (
    typeof left.timestamp === 'number' && typeof right.timestamp === 'number'
    && left.timestamp !== right.timestamp
  ) return false
  const leftContent = assistantContentKey(left)
  const rightContent = assistantContentKey(right)
  return leftContent !== null && rightContent !== null && leftContent === rightContent
}

/** Extracts the concatenated text from a user message's content, or null when no text is present. */
function extractUserText(message: JsonObject): string | null {
  if (message.role !== 'user') return null
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: string; text: string } =>
        isObject(part) && part.type === 'text' && typeof part.text === 'string'
      )
      .map((part) => part.text)
      .join('')
    return text || null
  }
  return null
}

/** Returns a stable comparison key without reserializing the same message for every candidate. */
function messageMatchKey(message: JsonObject): string | null {
  const userText = extractUserText(message)
  if (userText !== null) return `user\u0000${userText}`
  const assistantContent = assistantContentKey(message)
  return assistantContent === null ? null : `assistant\u0000${assistantContent}`
}

function assistantContentKey(message: JsonObject): string | null {
  if (message.role !== 'assistant') return null
  const content = message.content ?? message.output
  if (content === undefined) return null
  return JSON.stringify(content) ?? null
}

/** Checks the non-content part of a match after both messages share an index key. */
function sameIndexedMessage(left: JsonObject, right: JsonObject): boolean {
  if (left.role === 'user' && right.role === 'user') return extractUserText(left) !== null
  if (left.role !== 'assistant' || right.role !== 'assistant') return false
  return !(
    typeof left.timestamp === 'number' && typeof right.timestamp === 'number'
    && left.timestamp !== right.timestamp
  )
}

/** Matches messages so optimistic users reconcile with history and assistants retain their identity. */
export function sameMessage(left: JsonObject, right: JsonObject): boolean {
  const leftKey = messageMatchKey(left)
  return leftKey !== null && leftKey === messageMatchKey(right)
    && sameIndexedMessage(left, right)
}

/** Merges history and streamed messages while retaining each streamed message's React identity. */
export function conversationMessageEntries(
  historyMessages: JsonObject[],
  liveMessages: LiveMessage[],
): ConversationMessageEntry[] {
  const liveByKey = new Map<string, LiveMessage[]>()
  for (const live of liveMessages) {
    const key = messageMatchKey(live.message)
    if (key === null) continue
    const bucket = liveByKey.get(key)
    if (bucket) bucket.push(live)
    else liveByKey.set(key, [live])
  }
  const matchedLiveIds = new Set<string>()
  const historyEntries = historyMessages.map((message, historyIndex): ConversationMessageEntry => {
    const key = messageMatchKey(message)
    const candidates = key === null ? undefined : liveByKey.get(key)
    const candidateIndex = candidates
      ?.findIndex((live) => sameIndexedMessage(message, live.message)) ?? -1
    const live = candidateIndex >= 0 ? candidates?.[candidateIndex] : undefined
    if (live) {
      matchedLiveIds.add(live.id)
      candidates?.splice(candidateIndex, 1)
    }
    return {
      key: live?.id ?? `history-${String(message.timestamp ?? '')}-${historyIndex}`,
      message,
      source: 'history',
      historyIndex,
    }
  })
  const liveEntriesByHistoryIndex = new Map<number, ConversationMessageEntry[]>()
  for (const { id, message, historyIndex } of liveMessages) {
    if (matchedLiveIds.has(id)) continue
    const index = Math.max(
      0,
      Math.min(historyEntries.length, historyIndex ?? historyEntries.length),
    )
    const entries = liveEntriesByHistoryIndex.get(index)
    const entry = { key: id, message, source: 'live' as const }
    if (entries) entries.push(entry)
    else liveEntriesByHistoryIndex.set(index, [entry])
  }
  const entries: ConversationMessageEntry[] = []
  for (let index = 0; index <= historyEntries.length; index += 1) {
    entries.push(...(liveEntriesByHistoryIndex.get(index) ?? []))
    if (index < historyEntries.length) entries.push(historyEntries[index])
  }
  return entries
}

/** Returns assistant content before the tool calls belonging to that message. */
export function assistantTurnParts(message: JsonObject): AssistantTurnPart[] {
  return [
    { kind: 'message', message },
    ...toolCallsInMessage(message).map((call) => ({ kind: 'tool' as const, call })),
  ]
}
