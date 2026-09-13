import { isObject } from './is-object.ts'
import type { JsonObject } from './types.ts'

/** Status key used only to carry a bounded child Pi event through the parent RPC stream. */
export const subagentEventStatusKey = 'pi-livecraft.subagent-event'
export const subagentEventSchemaVersion = 1
export const maxSubagentEventPayloadBytes = 24_576

const maxIdentifierLength = 200
const maxEventTypeLength = 120
const maxSequence = 1_000_000_000

export interface SubagentRelayEnvelope {
  schemaVersion: typeof subagentEventSchemaVersion
  agentId: string
  childSessionId: string
  sequence: number
  event: JsonObject
}

/** Parses and bounds an event envelope received from the parent Pi process. */
export function parseSubagentRelayEnvelope(value: unknown): SubagentRelayEnvelope | undefined {
  if (typeof value !== 'string' || byteLength(value) > maxSubagentEventPayloadBytes)
    return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (
    !isObject(parsed)
    || !hasOnlyKeys(parsed, ['schemaVersion', 'agentId', 'childSessionId', 'sequence', 'event'])
    || parsed.schemaVersion !== subagentEventSchemaVersion
  ) return undefined

  const agentId = boundedString(parsed.agentId, maxIdentifierLength)
  const childSessionId = boundedString(parsed.childSessionId, maxIdentifierLength)
  if (!agentId || !childSessionId) return undefined
  if (
    typeof parsed.sequence !== 'number'
    || !Number.isSafeInteger(parsed.sequence)
    || parsed.sequence < 1
    || parsed.sequence > maxSequence
    || !isObject(parsed.event)
  ) return undefined

  let eventPayload: string
  try {
    eventPayload = JSON.stringify(parsed.event)
  } catch {
    return undefined
  }
  if (byteLength(eventPayload) > maxSubagentEventPayloadBytes) return undefined
  if (
    typeof parsed.event.type !== 'string' || !boundedString(parsed.event.type, maxEventTypeLength)
  )
    return undefined

  return {
    schemaVersion: subagentEventSchemaVersion,
    agentId,
    childSessionId,
    sequence: parsed.sequence,
    event: parsed.event,
  }
}

/** Serializes one public AgentSession event without allowing an oversized UI status. */
export function serializeSubagentRelayEnvelope(
  agentId: string,
  childSessionId: string,
  sequence: number,
  event: JsonObject,
): string | undefined {
  const envelope = {
    schemaVersion: subagentEventSchemaVersion,
    agentId,
    childSessionId,
    sequence,
    event,
  }
  let value: string
  try {
    value = JSON.stringify(envelope)
  } catch {
    return undefined
  }
  return byteLength(value) <= maxSubagentEventPayloadBytes ? value : undefined
}

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
      && !/[\u0000-\u001f]/.test(value)
    ? value
    : undefined
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
