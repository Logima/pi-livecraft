import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

/** Makes technical values readable in composer labels without changing RPC values. */
export function capitalizeLabel(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

export { isObject }

export function formatTokens(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)
}

/** Formats the latest turn throughput using Pi's cumulative output counters. */
export function formatTokensPerSecond(
  messages: JsonObject[],
  requestDurations: ReadonlyMap<number, number>,
): string {
  let userIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return '—'

  const timestamp = messages[userIndex]?.timestamp
  const duration = typeof timestamp === 'number' ? requestDurations.get(timestamp) : undefined
  if (duration === undefined || duration <= 0) return '—'

  const output = messages.slice(userIndex + 1).reduce((total, message) => {
    if (message?.role !== 'assistant' && message?.role !== 'toolResult') return total
    const usage = isObject(message.usage) ? message.usage.output : undefined
    return typeof usage === 'number' && Number.isFinite(usage) ? total + usage : total
  }, 0)
  return output > 0 ? `${(output * 1000 / duration).toFixed(1)} tok/s` : '—'
}

/** Returns true when the draft starts with a slash command exposed by Pi. */
export function isCommandDraft(text: string, commands: JsonObject[]): boolean {
  const name = /^\/([^\s]+)/.exec(text.trim())?.[1].toLowerCase()
  return name !== undefined
    && commands.some((command) => String(command.name).toLowerCase() === name)
}

/** Returns true when the trimmed draft is exactly the /compact slash command with no arguments. */
export function isCompactCommandDraft(text: string): boolean {
  return text.trim() === '/compact'
}

/** Prepends the local compact command when Pi does not already expose it in the snapshot. */
export function ensureCompactCommand(commands: JsonObject[]): JsonObject[] {
  return commands.some((cmd) => String(cmd.name).toLowerCase() === 'compact')
    ? commands
    : [{ name: 'compact' }, ...commands]
}

/** Adds local session commands without overriding commands provided by Pi. */
export function ensureSessionCommands(commands: JsonObject[]): JsonObject[] {
  const names = new Set(commands.map((command) => String(command.name).toLowerCase()))
  const localCommands = [
    { name: 'new', description: 'Start a new session' },
    { name: 'clear', description: 'Start a new session' },
    { name: 'reload', description: 'Reload Pi resources' },
  ]
    .filter(({ name }) => !names.has(name))
  return [...localCommands, ...commands]
}

/** Returns true for either local alias that starts a new session. */
export function isNewSessionCommandDraft(text: string): boolean {
  return /^\/(?:new|clear)$/.test(text.trim().toLowerCase())
}

/** Returns true when the trimmed draft is exactly the /reload slash command. */
export function isReloadCommandDraft(text: string): boolean {
  return text.trim().toLowerCase() === '/reload'
}

/** Identifies local commands that are complete as soon as they are selected. */
export function commandTakesArguments(command: JsonObject): boolean {
  return !['clear', 'compact', 'new', 'reload'].includes(String(command.name).toLowerCase())
}

/** Restores the draft for one session from local storage. */
export function readComposerDraft(storageKey: string): string {
  try {
    const storage = (globalThis as typeof globalThis & {
      localStorage?: { getItem: (key: string) => string | null }
    })
      .localStorage
    return storage?.getItem(storageKey) ?? ''
  } catch {
    return ''
  }
}
