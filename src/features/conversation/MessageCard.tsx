import { memo, type ReactNode } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { CopyButton } from './CopyButton.tsx'
import { ForkButton } from './ForkButton.tsx'
import { Markdown } from './Markdown.tsx'
import { hasVisibleContent, reasoningTextForDisplay } from './message-display.ts'
import { formatTokens, formatTurnCost, type MessageUsage } from './message-usage.ts'

/** Renders a visible protocol message with the default or custom presentation. */
export const MessageCard = memo(
  function MessageCard(
    { message, onError, onFork, workspacePath }: {
      message: JsonObject
      onError: (cause: unknown) => void
      onFork: (entryId: string) => Promise<boolean>
      workspacePath: string
    },
  ) {
    if (message.role === 'custom' && message.customType === 'pi-notification')
      return <PiNotificationMessage message={message} />
    if (message.role === 'custom' && typeof message.customType === 'string')
      return <DefaultCustomMessage message={message} workspacePath={workspacePath} />
    return (
      <DefaultMessageCard
        message={message}
        onError={onError}
        onFork={onFork}
        workspacePath={workspacePath}
      />
    )
  },
)

const DefaultMessageCard = memo(
  function DefaultMessageCard(
    { message, onError, onFork, workspacePath }: {
      message: JsonObject
      onError: (cause: unknown) => void
      onFork: (entryId: string) => Promise<boolean>
      workspacePath: string
    },
  ) {
    const role = String(message.role)
    const timestamp = typeof message.timestamp === 'number' ? new Date(message.timestamp) : null
    const time = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null
    const text = visibleText(message.content ?? message.output)
    const forkEntryId = role === 'user' && typeof message.forkEntryId === 'string'
      ? message.forkEntryId
      : undefined
    return (
      <article className={`message ${role}`}>
        {(text || forkEntryId) && (
          <div className='conversation-actions message-actions'>
            {forkEntryId && <ForkButton entryId={forkEntryId} onError={onError} onFork={onFork} />}
            {text && <CopyButton label='Copy message' onError={onError} value={text} />}
          </div>
        )}
        <div className='content'>
          {renderContent(message.content ?? message.output, message.role, onError, workspacePath)}
        </div>
        {role === 'user' && time && (
          <time
            className='message-time'
            dateTime={time.toISOString()}
            title={formatFullDateTime(time)}
          >
            {formatMessageTime(time)}
          </time>
        )}
      </article>
    )
  },
)

/** Renders multiline output from a non-blocking Pi extension request in the thread. */
function PiNotificationMessage({ message }: { message: JsonObject }) {
  return (
    <article className='message custom-message pi-notification'>
      <pre className='pi-notification-content'>{String(message.content ?? '')}</pre>
    </article>
  )
}

/** Renders an unknown custom message without interpreting extension-specific details. */
function DefaultCustomMessage({
  message,
  workspacePath,
}: {
  message: JsonObject & { customType?: unknown }
  workspacePath: string
}) {
  const content = hasVisibleContent(message.content)
    ? renderContent(message.content, message.role, undefined, workspacePath)
    : <p>Message has no displayable content.</p>
  return (
    <article className='message custom-message'>
      <code className='custom-message-type'>{String(message.customType)}</code>
      <div className='content'>{content}</div>
    </article>
  )
}

/** Displays counters billed by Pi for a completed assistant response. */
export function TurnUsage(
  { timestamp, turnNumber, usage }: {
    timestamp?: number
    turnNumber?: number
    usage: MessageUsage
  },
) {
  const time = typeof timestamp === 'number' ? new Date(timestamp) : null
  const validTime = time && !Number.isNaN(time.getTime()) ? time : null
  return (
    <dl className='turn-usage'>
      {turnNumber !== undefined && (
        <div>
          <dt>Turn</dt>
          <dd>{turnNumber}</dd>
        </div>
      )}
      {validTime && (
        <div className='turn-usage-time'>
          <time dateTime={validTime.toISOString()} title={formatFullDateTime(validTime)}>
            {formatMessageTime(validTime)}
          </time>
        </div>
      )}
      <div>
        <dt>Cache read</dt>
        <dd>{formatTokens(usage.cacheRead)}</dd>
      </div>
      <div>
        <dt>Cache miss</dt>
        <dd>{formatTokens(usage.cacheMiss)}</dd>
      </div>
      <div>
        <dt>Output</dt>
        <dd>{formatTokens(usage.output)}</dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>{formatTurnCost(usage.cost)}</dd>
      </div>
    </dl>
  )
}

function formatMessageTime(time: Date): string {
  return time.toLocaleTimeString(navigator.language, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function formatFullDateTime(time: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(time)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const offset = values.timeZoneName?.replace(/GMT([+-])0?(\d{1,2}):00$/, 'GMT$1$2') ?? 'GMT+0'
  return `${values.day}.${values.month}.${values.year} ${values.hour}:${values.minute}:${values.second} ${offset}`
}

function visibleText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
    )
    .join('')
}

/** Renders message content in protocol order, including visible thinking. */
function renderContent(
  content: unknown,
  role: unknown,
  onError?: (cause: unknown) => void,
  workspacePath?: string,
): ReactNode {
  if (typeof content === 'string')
    return (
      <Markdown copyablePre={role === 'assistant'} onError={onError} workspacePath={workspacePath}>
        {content}
      </Markdown>
    )
  if (!Array.isArray(content)) return null
  return (
    <>
      {content.map((part, contentIndex) => {
        if (isImageContent(part))
          return (
            <img
              alt={`Attached image ${contentIndex + 1}`}
              className='message-image'
              key={`image-${contentIndex}`}
              src={`data:${part.mimeType};base64,${part.data}`}
            />
          )
        if (!isObject(part)) return null
        if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim())
          return (
            <ReasoningBlock
              copyablePre={role === 'assistant'}
              key={`reasoning-${contentIndex}`}
              onError={onError}
            >
              {reasoningTextForDisplay(role, part.thinking)}
            </ReasoningBlock>
          )
        if (part.type === 'text' && typeof part.text === 'string')
          return (
            <Markdown
              copyablePre={role === 'assistant'}
              key={`text-${contentIndex}`}
              onError={onError}
              workspacePath={workspacePath}
            >
              {part.text}
            </Markdown>
          )
        return null
      })}
    </>
  )
}

/** Presents thinking directly in the thread with a subtle hierarchy. */
function ReasoningBlock(
  { children, copyablePre, live = false, onError }: {
    children: string
    copyablePre: boolean
    live?: boolean
    onError?: (cause: unknown) => void
  },
) {
  return (
    <div className={`reasoning${live ? ' conversation-entry' : ''}`}>
      <Markdown copyablePre={copyablePre} onError={onError}>{children}</Markdown>
    </div>
  )
}

function isImageContent(value: unknown): value is JsonObject & { data: string; mimeType: string } {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string' && typeof value
        .mimeType === 'string'
    && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}
