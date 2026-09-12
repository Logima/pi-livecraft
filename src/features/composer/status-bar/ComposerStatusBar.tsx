import { memo } from 'react'
import type { SessionSummary } from '../../../../shared/types.ts'
import { SessionInfo } from './SessionInfo.tsx'
import { SessionStats } from './SessionStats.tsx'

/** Status bar shown below the composer: session name, directory, cost, and context usage. */
export const ComposerStatusBar = memo(function ComposerStatusBar(
  {
    session,
    running,
    compacting,
    cost,
    speed,
    contextClass,
    contextTokens,
    contextPercent,
    contextPercentValue,
  }: {
    session: SessionSummary
    running: boolean
    compacting: boolean
    cost: string
    speed: string
    contextClass: string
    contextTokens: string
    contextPercent: string
    contextPercentValue: number | null
  },
) {
  return (
    <div className='composer-info' aria-label='Session information'>
      {compacting
        ? (
          <div aria-label='Compaction in progress' className='composer-compacting' role='status'>
            <span aria-hidden='true' className='composer-compacting-spinner' /> Compaction en cours…
          </div>
        )
        : <SessionInfo name={session.name} cwd={session.cwd} active={running} />}
      <SessionStats
        cost={cost}
        speed={speed}
        contextClass={contextClass}
        contextTokens={contextTokens}
        contextPercent={contextPercent}
        contextPercentValue={contextPercentValue}
      />
    </div>
  )
})
