import {
  editDiffDisplayLines,
  intraLineDiff,
  toolEditChanges,
  type EditDiffLine,
} from './tool-presentation.ts'

/** Renders segments with intra-line highlights for changed words. */
function DiffLineContent(
  { content, segments }: {
    content: string
    segments?: { text: string; kind: 'added' | 'removed' | 'shared'; highlighted?: boolean }[]
  },
) {
  if (!segments || segments.length === 0) return <pre>{content}</pre>
  return (
    <pre>{segments.map((seg, i) => <span className={seg.highlighted === false ? undefined : `diff-seg-${seg.kind}`} key={i}>{seg.text}</span>)}</pre>
  )
}

/** Displays each replacement from an edit call, preferring Pi's line-numbered diff when available. */
export function ToolCallEditDiff(
  { changes, diffLines }: {
    changes: ReturnType<typeof toolEditChanges>
    diffLines: EditDiffLine[]
  },
) {
  if (diffLines.length > 0) {
    const displayLines = editDiffDisplayLines(diffLines)

    return (
      <section className='tool-call-content tool-call-edit-diff'>
        <section className='tool-call-edit-change'>
          {displayLines.map((line, j) => {
            const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '
            return (
              <div className={`tool-call-edit-line ${line.kind}`} key={j}>
                <span>{line.lineNumber ?? ''}</span>
                <i aria-hidden='true'>{sign}</i>
                <DiffLineContent content={line.content} segments={line.segments} />
              </div>
            )
          })}
        </section>
      </section>
    )
  }

  return (
    <section className='tool-call-content tool-call-edit-diff'>
      {changes.map((change, index) => {
        const segments = intraLineDiff(change.oldText, change.newText)
        return (
          <section className='tool-call-edit-change' key={index}>
            <h4>Change {index + 1}</h4>
            <div className='tool-call-edit-line removed'>
              <span />
              <i aria-hidden='true'>−</i>
              <pre>{segments.filter(s => s.kind !== 'added').map((seg, si) => <span className={seg.highlighted === false ? undefined : `diff-seg-${seg.kind}`} key={si}>{seg.text}</span>)}</pre>
            </div>
            <div className='tool-call-edit-line added'>
              <span />
              <i aria-hidden='true'>+</i>
              <pre>{segments.filter(s => s.kind !== 'removed').map((seg, si) => <span className={seg.highlighted === false ? undefined : `diff-seg-${seg.kind}`} key={si}>{seg.text}</span>)}</pre>
            </div>
          </section>
        )
      })}
    </section>
  )
}
