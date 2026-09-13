import { startTransition, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { getSnapshot } from '../../api.ts'
import {
  assistantMessageAfterEvent,
  assistantMessageInEvent,
} from '../../../shared/assistant-message-stream.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject, SessionSnapshot } from '../../../shared/types.ts'
import { activityForPiEvent, type Activity } from './activity.ts'
import { advanceEventSequence } from './event-sequence.ts'
import type { LiveMessage } from './message-reconciliation.ts'
import {
  applyToolCallUpdate,
  applyToolExecutionUpdate,
  interruptToolCallGeneration,
  toolCallInUpdate,
  toolExecutionUpdateInEvent,
  type ToolExecution,
  type ToolResult,
} from './tool-protocol.ts'

const emptySnapshot: SessionSnapshot = {
  state: null,
  messages: [],
  models: [],
  commands: [],
  promptTemplates: [],
  stats: null,
  liveEvents: [],
}

const snapshotRefreshDelayMs = 100
const liveUpdateIntervalMs = 80

interface SnapshotRefreshRequest {
  sessionId: string
  needsRefresh: boolean
  cancelled: boolean
  promise: Promise<SessionSnapshot | undefined>
}

/** Owns the selected conversation snapshot, live stream, replay, tools, and timing state. */
export function useConversationRuntime(
  selectedId: string,
  onError: (cause: unknown) => void,
  replayEvent: (sessionId: string, event: JsonObject, sequence?: number) => void,
) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(emptySnapshot)
  const [snapshotSessionId, setSnapshotSessionId] = useState('')
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([])
  const [pendingSteering, setPendingSteering] = useState<string[]>([])
  const [activity, setActivity] = useState<Activity | null>(null)
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [observedToolDurations, setObservedToolDurations] = useState<ReadonlyMap<string, number>>(
    new Map(),
  )
  const [observedRequestDurations, setObservedRequestDurations] = useState<
    ReadonlyMap<number, number>
  >(new Map())
  const [observedResponseSpeeds, setObservedResponseSpeeds] = useState<ReadonlyMap<string, number>>(
    new Map(),
  )
  const selectedIdRef = useRef(selectedId)
  const snapshotSessionIdRef = useRef('')
  const snapshotRefreshVersionRef = useRef(0)
  const snapshotRefreshRef = useRef<SnapshotRefreshRequest | undefined>(undefined)
  const snapshotCacheRef = useRef(new Map<string, SessionSnapshot>())
  const appliedPiEventSequenceRef = useRef(0)
  const toolStartedAtRef = useRef(new Map<string, number>())
  const requestStartedAtRef = useRef<number | undefined>(undefined)
  const queueUpdateVersionRef = useRef(0)
  const liveMessagesRef = useRef<LiveMessage[]>([])
  const liveMessageIndexRef = useRef(-1)
  const pendingLiveMessagesRef = useRef<LiveMessage[] | undefined>(undefined)
  const historyLengthRef = useRef(0)
  const liveUpdateTimerRef = useRef<number | undefined>(undefined)
  selectedIdRef.current = selectedId
  historyLengthRef.current = snapshot.messages.length

  /** Applies the latest streamed assistant messages at a bounded rate. */
  const flushLiveUpdates = useCallback(() => {
    if (liveUpdateTimerRef.current !== undefined)
      window.clearTimeout(liveUpdateTimerRef.current)
    liveUpdateTimerRef.current = undefined
    const pending = pendingLiveMessagesRef.current
    pendingLiveMessagesRef.current = undefined
    if (pending) {
      liveMessagesRef.current = pending
      startTransition(() => setLiveMessages(pending))
    }
  }, [])

  /** Queues a complete public-RPC assistant message without rendering every SSE delta. */
  const queueLiveMessage = useCallback((message: JsonObject) => {
    const index = liveMessageIndexRef.current
    if (index < 0) return
    const next = [...(pendingLiveMessagesRef.current ?? liveMessagesRef.current)]
    next[index] = { ...next[index], message }
    pendingLiveMessagesRef.current = next
    if (liveUpdateTimerRef.current !== undefined) return
    liveUpdateTimerRef.current = window.setTimeout(flushLiveUpdates, liveUpdateIntervalMs)
  }, [flushLiveUpdates])

  /** Clears streamed assistant messages when the displayed session changes. */
  const clearLiveMessages = useCallback(() => {
    if (liveUpdateTimerRef.current !== undefined)
      window.clearTimeout(liveUpdateTimerRef.current)
    liveUpdateTimerRef.current = undefined
    pendingLiveMessagesRef.current = undefined
    liveMessagesRef.current = []
    liveMessageIndexRef.current = -1
    setLiveMessages([])
  }, [])

  /** Synchronizes the selected snapshot and replays newer buffered manager events. */
  const refreshSnapshot = useCallback((sessionId: string): Promise<SessionSnapshot | undefined> => {
    if (!sessionId) {
      const current = snapshotRefreshRef.current
      if (current) current.cancelled = true
      snapshotSessionIdRef.current = ''
      setSnapshot(emptySnapshot)
      setSnapshotSessionId('')
      return Promise.resolve(undefined)
    }
    const current = snapshotRefreshRef.current
    if (current?.sessionId === sessionId) {
      current.needsRefresh = true
      return current.promise
    }
    if (current) current.cancelled = true
    const request = {
      sessionId,
      needsRefresh: false,
      cancelled: false,
    } as SnapshotRefreshRequest
    request.promise = (async () => {
      let nextSnapshot: SessionSnapshot | undefined
      // Fetch a newly selected session immediately, while retaining debounce for later refreshes.
      let delayNextRefresh = snapshotSessionIdRef.current === sessionId
      do {
        if (delayNextRefresh)
          await new Promise<void>((resolve) => window.setTimeout(resolve, snapshotRefreshDelayMs))
        if (request.cancelled) return nextSnapshot
        delayNextRefresh = true
        request.needsRefresh = false
        const version = ++snapshotRefreshVersionRef.current
        try {
          nextSnapshot = await getSnapshot(sessionId)
          snapshotCacheRef.current.set(sessionId, nextSnapshot)
          if (request.cancelled) return nextSnapshot
          if (version !== snapshotRefreshVersionRef.current || sessionId !== selectedIdRef.current)
            return nextSnapshot
          flushLiveUpdates()
          snapshotSessionIdRef.current = sessionId
          setSnapshot(nextSnapshot)
          setSnapshotSessionId(sessionId)
          const latestLiveSequence = nextSnapshot.liveEvents.at(-1)?.sequence ?? 0
          if (latestLiveSequence > appliedPiEventSequenceRef.current) {
            clearLiveMessages()
            setActivity(null)
            setToolExecutions([])
            appliedPiEventSequenceRef.current = 0
            for (const liveEvent of nextSnapshot.liveEvents) {
              replayEvent(
                sessionId,
                liveEvent.data,
                liveEvent.sequence,
              )
            }
          }
        } catch (cause) {
          if (
            !request.cancelled
            && version === snapshotRefreshVersionRef.current
            && sessionId === selectedIdRef.current
          ) onError(cause)
          return nextSnapshot
        }
      } while (request.needsRefresh && !request.cancelled)
      return nextSnapshot
    })()
      .finally(() => {
        if (snapshotRefreshRef.current === request) snapshotRefreshRef.current = undefined
      })
    snapshotRefreshRef.current = request
    return request.promise
  }, [clearLiveMessages, flushLiveUpdates, onError, replayEvent])

  /** Applies a selected-session Pi event once, preserving stream sequence and replay order. */
  const handlePiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      if (sessionId !== selectedIdRef.current) return
      const nextSequence = advanceEventSequence(appliedPiEventSequenceRef.current, sequence)
      if (nextSequence === null) return
      appliedPiEventSequenceRef.current = nextSequence
      if (event.type === 'queue_update' && Array.isArray(event.steering)) {
        const steering = event.steering.filter((message): message is string =>
          typeof message === 'string'
        )
        const version = ++queueUpdateVersionRef.current
        setPendingSteering((current) => steering.length > current.length ? steering : current)
        void refreshSnapshot(sessionId).finally(() => {
          if (version === queueUpdateVersionRef.current && sessionId === selectedIdRef.current)
            setPendingSteering(steering)
        })
      }
      if (event.type === 'agent_start') requestStartedAtRef.current = performance.now()
      if (event.type === 'agent_end' && event.willRetry !== true) {
        const startedAt = requestStartedAtRef.current
        const output = outputTokensInAgentEnd(event)
        if (startedAt !== undefined && output > 0) {
          setObservedResponseSpeeds((current) =>
            new Map(current).set(
              sessionId,
              output / ((performance.now() - startedAt) / 1000),
            )
          )
        }
      }
      const streamedToolCall = toolCallInUpdate(event)
      if (streamedToolCall) {
        flushLiveUpdates()
        setToolExecutions((current) =>
          applyToolCallUpdate(current, streamedToolCall, crypto.randomUUID())
        )
      }
      const toolExecutionUpdate = toolExecutionUpdateInEvent(event)
      if (toolExecutionUpdate)
        setToolExecutions((current) => applyToolExecutionUpdate(current, toolExecutionUpdate))
      if (
        event.type === 'tool_execution_start' && typeof event.toolCallId === 'string'
        && typeof event.toolName === 'string'
      ) {
        const { args, toolCallId: id, toolName: name } = event
        toolStartedAtRef.current.set(id, performance.now())
        setToolExecutions((current) => [
          ...current.filter((execution) => execution.id !== id),
          { id, name, args, status: 'running' },
        ])
      }
      if (
        event.type === 'tool_execution_end' && typeof event.toolCallId === 'string' && typeof event
            .toolName === 'string'
      ) {
        const id = event.toolCallId
        const startedAt = toolStartedAtRef.current.get(id)
        if (startedAt !== undefined) {
          setObservedToolDurations((current) =>
            new Map(current).set(id, performance.now() - startedAt)
          )
          toolStartedAtRef.current.delete(id)
        }
        const details = isObject(event.result) ? event.result.details : undefined
        const result: ToolResult = {
          toolCallId: id,
          toolName: event.toolName,
          content: event.result,
          isError: event.isError === true,
          details,
        }
        setToolExecutions((current) =>
          current.map((execution) => execution.id === id ? { ...execution, result } : execution)
        )
        void refreshSnapshot(sessionId)
      }
      setActivity((current) => {
        const next = activityForPiEvent(current, event)
        return next?.kind === current?.kind ? current : next
      })
      if (event.type === 'message_start') {
        flushLiveUpdates()
        setToolExecutions(interruptToolCallGeneration)
        const message = assistantMessageInEvent(event)
        if (message) {
          const next = [...liveMessagesRef.current, {
            id: crypto.randomUUID(),
            message,
            historyIndex: historyLengthRef.current,
          }]
          liveMessagesRef.current = next
          liveMessageIndexRef.current = next.length - 1
          setLiveMessages(next)
        }
      }
      if (event.type === 'message_update' && isObject(event.assistantMessageEvent)) {
        const live = (pendingLiveMessagesRef.current ?? liveMessagesRef.current)[
          liveMessageIndexRef.current
        ]
        const message = assistantMessageAfterEvent(live?.message ?? null, event)
        if (message) queueLiveMessage(message)
        if (event.assistantMessageEvent.type === 'error')
          setToolExecutions(interruptToolCallGeneration)
      }
      if (event.type === 'message_end') {
        const live = (pendingLiveMessagesRef.current ?? liveMessagesRef.current)[
          liveMessageIndexRef.current
        ]
        const message = assistantMessageAfterEvent(live?.message ?? null, event)
        if (message) queueLiveMessage(message)
      }
      const settledRequestDuration = event
              .type === 'agent_settled' && requestStartedAtRef.current !== undefined
        ? performance.now() - requestStartedAtRef.current
        : undefined
      if (event.type === 'agent_settled') requestStartedAtRef.current = undefined
      if (event.type === 'message_end' || event.type === 'agent_settled') {
        flushLiveUpdates()
        setToolExecutions(interruptToolCallGeneration)
        void refreshSnapshot(sessionId).then((nextSnapshot) => {
          if (!nextSnapshot || settledRequestDuration === undefined) return
          const requestTimestamp = lastUserTimestamp(nextSnapshot.messages)
          if (requestTimestamp !== undefined)
            setObservedRequestDurations((current) =>
              new Map(current).set(requestTimestamp, settledRequestDuration)
            )
        })
      }
    },
    [flushLiveUpdates, queueLiveMessage, refreshSnapshot],
  )

  useLayoutEffect(() => {
    clearLiveMessages()
    appliedPiEventSequenceRef.current = 0
    const cachedSnapshot = snapshotCacheRef.current.get(selectedId)
    snapshotSessionIdRef.current = cachedSnapshot ? selectedId : ''
    setSnapshot(cachedSnapshot ?? emptySnapshot)
    setSnapshotSessionId(cachedSnapshot ? selectedId : '')
    setPendingSteering([])
    queueUpdateVersionRef.current += 1
    setActivity(null)
    setToolExecutions([])
    setObservedToolDurations(new Map())
    // Request durations are keyed by user-message timestamp, so retaining them lets the
    // composer restore the latest speed when the user switches back to this session.
    toolStartedAtRef.current.clear()
    requestStartedAtRef.current = undefined
    void refreshSnapshot(selectedId)
  }, [clearLiveMessages, refreshSnapshot, selectedId])

  const addPendingSteering = useCallback((message: string): void => {
    setPendingSteering((current) => [...current, message])
  }, [])

  /** Adds transient Pi output to the selected conversation without pretending it is an assistant turn. */
  const addConversationNotice = useCallback((message: string): void => {
    flushLiveUpdates()
    const next = [...liveMessagesRef.current, {
      id: crypto.randomUUID(),
      historyIndex: historyLengthRef.current,
      message: {
        role: 'custom',
        customType: 'pi-notification',
        display: true,
        content: message,
      },
    }]
    liveMessagesRef.current = next
    setLiveMessages(next)
  }, [flushLiveUpdates])

  /** Removes the most recently queued optimistic steering message after a send failure. */
  const removePendingSteering = useCallback((message: string): void => {
    setPendingSteering((current) => {
      const index = current.lastIndexOf(message)
      return index < 0 ? current : current.toSpliced(index, 1)
    })
  }, [])

  /** Adds an optimistic user message and returns its removable identity. */
  const addOptimisticUserMessage = useCallback((message: string): string => {
    flushLiveUpdates()
    const id = crypto.randomUUID()
    const next = [...liveMessagesRef.current, {
      id,
      historyIndex: historyLengthRef.current,
      message: { role: 'user', content: message, timestamp: Date.now() },
    }]
    liveMessagesRef.current = next
    setLiveMessages(next)
    return id
  }, [flushLiveUpdates])

  const removeLiveMessage = useCallback((id: string): void => {
    liveMessagesRef.current = liveMessagesRef.current.filter((message) => message.id !== id)
    setLiveMessages(liveMessagesRef.current)
  }, [])

  const clearActivity = useCallback((): void => setActivity(null), [])
  const resetEventSequence = useCallback((): void => {
    appliedPiEventSequenceRef.current = 0
  }, [])

  return {
    activity,
    addConversationNotice,
    addOptimisticUserMessage,
    addPendingSteering,
    clearActivity,
    flushLiveUpdates,
    handlePiEvent,
    liveMessages,
    observedRequestDurations,
    observedResponseSpeed: observedResponseSpeeds.get(selectedId) ?? null,
    observedToolDurations,
    pendingSteering,
    refreshSnapshot,
    removeLiveMessage,
    removePendingSteering,
    resetEventSequence,
    snapshot,
    snapshotSessionId,
    toolExecutions,
  }
}

/** Sums provider-reported output tokens from one low-level agent run. */
function outputTokensInAgentEnd(event: JsonObject): number {
  if (!Array.isArray(event.messages)) return 0
  return event.messages.reduce((total, message) => {
    if (!isObject(message) || (message.role !== 'assistant' && message.role !== 'toolResult'))
      return total
    const usage = isObject(message.usage) ? message.usage.output : undefined
    return typeof usage === 'number' && Number.isFinite(usage) ? total + usage : total
  }, 0)
}

/** Returns the timestamp of the most recent user message, if any. */
function lastUserTimestamp(messages: JsonObject[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.timestamp === 'number') return message.timestamp
  }
  return undefined
}
