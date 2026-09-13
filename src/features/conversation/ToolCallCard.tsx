import { memo, useEffect, useRef, useState } from 'react'
import { resolveFileIcon } from '../../../shared/file-icon.ts'
import { isObject } from '../../../shared/is-object.ts'
import type { JsonObject } from '../../../shared/types.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import { urlForSession } from '../workspace/session-url.ts'
import { CopyButton } from './CopyButton.tsx'
import { canHighlightFile } from './file-preview.ts'
import { formatDuration } from './message-usage.ts'
import { OpenFileButton } from './OpenFileButton.tsx'
import {
  formatToolCallTooltip,
  formatToolData,
  provisionalToolName,
  readContentDisplay,
  toolCallPresentation,
  toolDataLength,
  toolDisplayName,
  toolFilePath,
  toolWriteContent,
} from './tool-presentation.ts'
import { ToolCallContent } from './ToolCallOutput.tsx'
import {
  agentExecutionStatus,
  toolContentText,
  type AgentExecutionStatus,
} from './tool-protocol.ts'
import { agentPendingStatus, resolveToolCallAgentId } from './tool-call-agent.ts'

export { Markdown } from './Markdown.tsx'
export { resolveToolCallAgentId } from './tool-call-agent.ts'

interface ToolCallCardProps {
  agentStatuses: ReadonlyMap<string, AgentExecutionStatus>
  animateLiveChanges?: boolean
  args: unknown
  bridgeAgentId?: string
  bridgeLatestActivity?: string
  hasResult: boolean
  id: string
  durationMs?: number
  interrupted?: boolean
  name: string
  onError: (cause: unknown) => void
  onKill: () => Promise<JsonObject>
  onOpenAgentSession: (agentId: string) => Promise<void>
  agentSessionIdForAgent: (agentId: string) => string | undefined
  repositoryRoot?: string | null
  partialResultContent?: unknown
  resultContent?: unknown
  resultDetails?: unknown
  resultError?: boolean
  semiDetailed?: boolean
  streaming?: boolean
  streamingArguments?: string
  targeted?: boolean
  workingDirectory: string
}

/** Displays the official card whose full result replaces the preview when expanded. */
export const ToolCallCard = memo(function ToolCallCard({
  agentStatuses,
  animateLiveChanges = false,
  args,
  bridgeAgentId,
  bridgeLatestActivity,
  hasResult,
  id,
  durationMs,
  interrupted = false,
  name,
  onError,
  onKill,
  onOpenAgentSession,
  agentSessionIdForAgent,
  partialResultContent,
  repositoryRoot,
  resultContent,
  resultDetails,
  resultError,
  semiDetailed = false,
  streaming = false,
  streamingArguments,
  targeted = false,
  workingDirectory,
}: ToolCallCardProps) {
  const toolName = name || provisionalToolName(args, streamingArguments) || ''
  const pending = !hasResult
  const active = pending && !interrupted
  const filePath = toolName === 'read' || toolName === 'write' || toolName === 'edit'
    ? toolFilePath(args)
    : null
  const display = filePath && toolName !== 'edit'
    ? readContentDisplay({ path: filePath })
    : { kind: 'text' as const }
  const [expanded, setExpanded] = useState(toolName === 'edit')
  const [semiExpanded, setSemiExpanded] = useState(false)
  const [partialOutputExpanded, setPartialOutputExpanded] = useState(false)
  const [codeRendered, setCodeRendered] = useState(false)
  const [argsExpanded, setArgsExpanded] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [openingAgentSession, setOpeningAgentSession] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const input = formatToolData(args)
  const inputLength = toolDataLength(args)
  const maxPreviewChars = 400
  const output = hasResult ? toolContentText(resultContent) : ''
  const partialOutput = !hasResult && partialResultContent !== undefined
    ? toolContentText(partialResultContent)
    : ''
  const partialOutputLength = partialOutput.length
  const partialOutputTruncated = partialOutputLength > maxPreviewChars
  const partialOutputPreviewText = partialOutputTruncated
    ? `${partialOutput.slice(0, maxPreviewChars)}…`
    : partialOutput
  const outputLength = output.length
  const durationLabel = durationMs === undefined ? undefined : formatDuration(durationMs)
  const displayedOutput = output || 'No output.'
  const presentation = toolCallPresentation(
    { id, name: toolName, args },
    repositoryRoot,
    streamingArguments,
  )
  const fileIcon = (toolName === 'read' || toolName === 'write' || toolName === 'edit')
      && presentation.headerDetail
    ? resolveFileIcon(presentation.headerDetail.title)
    : null
  const commandText = presentation.headerDetail?.text
  const headingName = toolDisplayName(toolName || 'tool')
  const displayedCommand = commandText
  const tooltip = formatToolCallTooltip(
    presentation.headerDetail?.title ?? input,
    inputLength,
    hasResult ? outputLength : undefined,
  )
  const resolvedSizeLabel = `Input: ${inputLength} characters. Output: ${outputLength} characters.${
    durationLabel ? ` Duration: ${durationLabel}.` : ''
  }`
  const writeContent = toolName === 'write' ? toolWriteContent(args) : null
  const content = toolName === 'write' && !resultError && writeContent
    ? writeContent
    : displayedOutput
  const contentError = resultError
  const streamingArgs = streaming || interrupted ? streamingArguments ?? input : undefined
  const streamingTruncated = Boolean(streamingArgs && streamingArgs.length > maxPreviewChars)
  const streamingPreviewText = streamingArgs && streamingArgs.length > maxPreviewChars
    ? `${streamingArgs.slice(0, maxPreviewChars)}…`
    : streamingArgs
  const renderingCode = display.kind === 'code' && canHighlightFile(content) && expanded
    && !codeRendered
  const agentId = toolName === 'Agent'
    ? resolveToolCallAgentId(resultDetails, bridgeAgentId)
    : undefined
  const detailStatus = isObject(resultDetails) ? resultDetails.status : undefined
  const agentStatus = agentId
    ? bridgeAgentId
      ? 'running'
      : agentStatuses.get(agentId) ?? agentExecutionStatus(detailStatus)
    : undefined
  const pendingAgentLabel = pending && agentStatus === 'running'
    ? agentPendingStatus(bridgeAgentId, bridgeLatestActivity)
    : undefined

  /** Force-kills the active tool's child process without aborting the Pi session. */
  const stopTool = async (): Promise<void> => {
    setStopping(true)
    try {
      await onKill()
    } catch (cause) {
      onError(cause)
    } finally {
      setStopping(false)
    }
  }

  /** Opens the delegated session while keeping navigation errors on the current card. */
  const openAgentSession = async (): Promise<void> => {
    if (!agentId) return
    setOpeningAgentSession(true)
    try {
      await onOpenAgentSession(agentId)
    } catch (cause) {
      onError(cause)
    } finally {
      setOpeningAgentSession(false)
    }
  }

  useEffect(() => {
    if (!expanded || display.kind !== 'code' || codeRendered) return
    const timeout = window.setTimeout(() => setCodeRendered(true), 0)
    return () => window.clearTimeout(timeout)
  }, [codeRendered, display.kind, expanded])

  useEffect(() => {
    if (semiDetailed) setSemiExpanded(false)
  }, [semiDetailed])

  /** Expands the call from its header-only presentation or toggles its full result. */
  const activate = () => {
    if (semiDetailed) {
      if (!semiExpanded) setExpanded(true)
      setSemiExpanded((isExpanded) => !isExpanded)
      return
    }
    setExpanded((isExpanded) => !isExpanded)
  }

  const showDetails = !semiDetailed || semiExpanded
  const hasBody = streaming || interrupted || hasResult || Boolean(partialOutput)

  return (
    <article
      className={`tool-call${animateLiveChanges && streaming ? ' entering' : ''}${
        contentError ? ' error' : ''
      }${interrupted ? ' interrupted' : ''}${semiDetailed ? ' semi-detailed' : ''}${
        targeted ? ' conversation-target' : ''
      }`}
      data-tool-call-id={id}
      ref={cardRef}
    >
      <div className='tool-call-header'>
        <Tooltip label={tooltip}>
          <button
            aria-expanded={semiDetailed ? semiExpanded : hasResult ? expanded : undefined}
            className='tool-call-heading'
            disabled={!hasResult && !semiDetailed}
            onClick={activate}
            type='button'
          >
            <span aria-hidden='true'>⌘</span>
            <span>
              <strong>{headingName}</strong>
            </span>
            {presentation.headerDetail && displayedCommand && (
              <span className='tool-call-command'>
                <code aria-label={`Full command: ${presentation.headerDetail.title}`}>
                  {displayedCommand}
                </code>
                {fileIcon && (
                  <span
                    aria-hidden='true'
                    className='tool-call-file-icon'
                    data-color={fileIcon.color}
                  >
                    {fileIcon.glyph}
                  </span>
                )}
              </span>
            )}
            {presentation.headerDetail?.suffix && (
              <span className='tool-call-range'>
                <code aria-label={`Read range: ${presentation.headerDetail.suffix}`}>
                  {presentation.headerDetail.suffix}
                </code>
              </span>
            )}
            <small
              aria-label={hasResult && !contentError
                ? resolvedSizeLabel
                : partialOutput
                ? `Output: ${partialOutputLength} characters so far`
                : undefined}
            >
              {active && presentation.pendingDetail && `${presentation.pendingDetail} · `}
              {hasResult
                ? contentError
                  ? 'Failed'
                  : (
                    <span aria-hidden='true'>
                      ↘ {inputLength} car. · ↗ {outputLength} car.
                      {durationLabel && ` · ⏱ ${durationLabel}`}
                    </span>
                  )
                : interrupted
                ? 'Generation interrupted'
                : streaming
                ? 'Generating…'
                : partialOutput
                ? <span aria-hidden='true'>↗ {partialOutputLength} car.</span>
                : pendingAgentLabel ?? 'In progress…'}
              {active && (
                <span
                  aria-label={streaming ? 'Arguments are being generated' : 'Tool in progress'}
                  className='spinner tool-call-spinner'
                  role='status'
                />
              )}
            </small>
          </button>
        </Tooltip>
        {agentStatus && (
          <span
            aria-label={`Delegated agent ${agentStatus}`}
            className={`agent-run-status ${agentStatus}`}
            role='img'
          >
            <span aria-hidden='true' />
            {agentStatus === 'running' ? 'Running' : 'Finished'}
          </span>
        )}
        {agentId && (
          <Tooltip label='Open delegated agent session'>
            <a
              aria-disabled={openingAgentSession || undefined}
              aria-label='Open delegated agent session'
              className='agent-session-link'
              href={urlForSession(agentSessionIdForAgent(agentId) ?? agentId)}
              onClick={(event) => {
                event.preventDefault()
                if (openingAgentSession) return
                void openAgentSession()
              }}
            >
              <span>{openingAgentSession ? 'Opening…' : 'Open'}</span>
              <svg aria-hidden='true' fill='none' viewBox='0 0 16 16'>
                <path d='M5 3h8v8M13 3 4 12' />
              </svg>
            </a>
          </Tooltip>
        )}
      </div>
      <div className='conversation-actions tool-call-actions'>
        <CopyButton direction='input' label='Copy tool input' onError={onError} value={input} />
        {active && (
          <Tooltip label='Kill tool process'>
            <button
              aria-label='Kill tool process'
              className='conversation-action-button danger'
              disabled={stopping}
              onClick={() => void stopTool()}
              type='button'
            >
              <svg aria-hidden='true' viewBox='0 0 16 16'>
                <rect height='8' rx='1.5' width='8' x='4' y='4' />
              </svg>
            </button>
          </Tooltip>
        )}
        {hasResult && (
          <CopyButton
            direction='output'
            label='Copy tool output'
            onError={onError}
            value={output}
          />
        )}
        {hasResult && !contentError && filePath && (
          <OpenFileButton cwd={workingDirectory} onError={onError} path={filePath} />
        )}
      </div>
      <div className={`tool-call-body${hasBody && showDetails ? ' visible' : ''}`}>
        <div>
          {(streaming || interrupted) && (
            <>
              {argsExpanded
                ? (
                  <button
                    aria-expanded={true}
                    className='tool-call-raw-args'
                    onClick={() => setArgsExpanded(false)}
                    type='button'
                  >
                    {streamingArgs || 'Waiting for arguments…'}
                  </button>
                )
                : (
                  <button
                    aria-expanded={false}
                    className='tool-call-preview'
                    onClick={() => setArgsExpanded(true)}
                    type='button'
                  >
                    <pre>{streamingPreviewText ?? 'Waiting for arguments…'}</pre>
                    {streamingTruncated && (
                      <span>Click to view full arguments ({streamingArgs?.length ?? 0} chars)</span>
                    )}
                  </button>
                )}
            </>
          )}
          {active && partialOutput && (
            <>
              {partialOutputExpanded
                ? (
                  <button
                    aria-expanded={true}
                    className='tool-call-raw-args'
                    onClick={() => setPartialOutputExpanded(false)}
                    type='button'
                  >
                    {partialOutput || 'Waiting for output…'}
                  </button>
                )
                : (
                  <button
                    aria-expanded={false}
                    className='tool-call-preview'
                    onClick={() => setPartialOutputExpanded(true)}
                    type='button'
                  >
                    <pre>{partialOutputPreviewText || 'Waiting for output…'}</pre>
                    {partialOutputTruncated && (
                      <span>Click to view full output ({partialOutputLength} chars)</span>
                    )}
                  </button>
                )}
            </>
          )}
          {hasResult && (
            <div className={animateLiveChanges ? 'tool-call-result entering' : 'tool-call-result'}>
              {expanded
                ? (
                  <ToolCallContent
                    call={{ name: toolName, args }}
                    content={content}
                    renderingCode={renderingCode}
                    resultDetails={resultDetails}
                    showEditDiff={!contentError}
                  />
                )
                : null}
            </div>
          )}
        </div>
      </div>
    </article>
  )
})
