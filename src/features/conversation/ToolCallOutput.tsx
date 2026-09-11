import { lazy, Suspense, type CSSProperties } from 'react'
import { canHighlightFile } from './file-preview.ts'
import { csvSourcePreview } from './csv-preview.ts'
import { ToolCallEditDiff } from './ToolCallEditDiff.tsx'
import {
  parseEditDiff,
  readContentDisplay,
  readStartingLineNumber,
  toolEditChanges,
} from './tool-presentation.ts'

const LazyCodeHighlighter = lazy(() => import('./CodeHighlighter'))

const lineNumberStyle: CSSProperties = {
  minWidth: '2.5em',
  paddingRight: '1em',
  textAlign: 'right',
  userSelect: 'none',
  opacity: 0.5,
}

/** Renders preformatted content with line numbers starting at an arbitrary offset. */
function NumberedPre({ content, startLine }: { content: string; startLine: number }) {
  const lines = content.split('\n')
  const displayLines = content.endsWith('\n') ? lines.slice(0, -1) : lines
  const width = String(startLine + displayLines.length - 1).length
  return (
    <pre className='tool-call-numbered-pre'>
    {displayLines.map((line, i) => {
      const num = startLine + i
      return <div key={i}><span>{String(num).padStart(width)}</span>{line}</div>
    })}
    </pre>
  )
}

/** Displays the complete CSV source while preserving the full value for copying. */
function CsvSourceContent({ content }: { content: string }) {
  const source = csvSourcePreview(content)
  return (
    <section className='tool-call-content tool-call-csv-source'>
      {source.truncated && (
        <p className='tool-call-notice'>Source preview limited to 20,000 characters.</p>
      )}
      <pre>{source.text}</pre>
    </section>
  )
}

/** Displays the full result in its appropriate format instead of the preview. */
export function ToolCallContent({
  call,
  content,
  renderingCode,
  resultDetails,
  showEditDiff,
}: {
  call: { name: string; args: unknown }
  content: string
  renderingCode: boolean
  resultDetails?: unknown
  showEditDiff: boolean
}) {
  if (renderingCode)
    return (
      <section className='tool-call-content tool-call-loading' role='status'>
        <span aria-hidden='true' className='spinner' />Highlighting file…
      </section>
    )

  const diffString = extractEditDiffString(resultDetails)
  const diffLines = diffString ? parseEditDiff(diffString) : []
  const changes = showEditDiff && call.name === 'edit' ? toolEditChanges(call.args) : []
  if (diffLines.length > 0 || changes.length > 0)
    return <ToolCallEditDiff changes={changes} diffLines={diffLines} />

  const rawContentDisplay = call.name === 'read' || call.name === 'write'
    ? readContentDisplay(call.args)
    : { kind: 'text' as const }
  const display = rawContentDisplay.kind === 'html' || rawContentDisplay.kind === 'svg'
    ? ({ kind: 'code' as const, language: 'markup' })
    : rawContentDisplay.kind === 'markdown'
    ? ({ kind: 'code' as const, language: 'markdown' })
    : rawContentDisplay
  if (rawContentDisplay.kind === 'csv')
    return <CsvSourceContent content={content} />

  const isRenderable = rawContentDisplay.kind === 'markdown'
    || rawContentDisplay.kind === 'html'
    || rawContentDisplay.kind === 'svg'
  const contentClassName = isRenderable
    ? `tool-call-content tool-call-content-scrollable${
      rawContentDisplay.kind === 'markdown' ? ' tool-call-content-markdown' : ''
    }`
    : 'tool-call-content'
  const isReadOrWrite = call.name === 'read' || call.name === 'write'
  const startLine = isReadOrWrite ? readStartingLineNumber(call.args) : 1
  if (display.kind === 'code' && canHighlightFile(content))
    return (
      <section className={contentClassName}>
        <Suspense
          fallback={isReadOrWrite
            ? <NumberedPre content={content} startLine={startLine} />
            : <pre>{content}</pre>}
        >
          <LazyCodeHighlighter
            className='tool-call-syntax'
            customStyle={{ background: 'transparent', margin: 0, padding: '9px 10px' }}
            language={display.language}
            PreTag='div'
            showLineNumbers={isReadOrWrite}
            startingLineNumber={isReadOrWrite ? startLine : undefined}
            lineNumberStyle={isReadOrWrite ? lineNumberStyle : undefined}
            wrapLongLines
          >
            {content}
          </LazyCodeHighlighter>
        </Suspense>
      </section>
    )
  if (display.kind === 'code')
    return (
      <section className={contentClassName}>
        <p className='tool-call-notice'>Highlighting disabled beyond 50,000 characters.</p>
        {isReadOrWrite
          ? <NumberedPre content={content} startLine={startLine} />
          : <pre>{content}</pre>}
      </section>
    )
  const plainSectionClass = isRenderable
    ? 'tool-call-content tool-call-content-scrollable'
    : 'tool-call-content'
  return (
    <section className={plainSectionClass}>
      {isReadOrWrite
        ? <NumberedPre content={content} startLine={startLine} />
        : <pre>{content}</pre>}
    </section>
  )
}

/** Extracts the display-oriented diff string from Pi result details when available. */
function extractEditDiffString(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  const d = details as Record<string, unknown>
  return typeof d.diff === 'string' ? d.diff : undefined
}
