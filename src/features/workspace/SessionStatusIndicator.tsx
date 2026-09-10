import { CompactingIcon } from '../../components/CompactingIcon.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { SessionIndicator } from './session-indicator.ts'

const indicatorLabels: Record<SessionIndicator, string> = {
  working: 'Pi is working',
  waiting: 'Pi is waiting for your response',
  compacting: 'Pi is compacting the session',
  complete: 'Pi finished its turn',
  idle: 'Pi is idle',
}

/** Reusable indicator using the same visual vocabulary as the workspace sidebar. */
export function SessionStatusIndicator(
  { label, status }: { label?: string; status: SessionIndicator },
) {
  const accessibleLabel = label ?? indicatorLabels[status]
  return (
    <Tooltip label={accessibleLabel}>
      <span
        aria-label={accessibleLabel}
        className={`session-status-indicator ${status}`}
        role='img'
      >
        {status === 'compacting' && <CompactingIcon />}
        {status === 'waiting' && <WaitingIcon />}
        {status === 'complete' && <CompleteIcon />}
      </span>
    </Tooltip>
  )
}

/** Filled chat-bubble icon for the waiting-for-response indicator. */
function WaitingIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='14' viewBox='0 0 24 24' width='14'>
      <path d='M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z' />
    </svg>
  )
}

/** Simple checkmark for completed sessions. */
function CompleteIcon() {
  return (
    <svg aria-hidden='true' fill='currentColor' height='14' viewBox='0 0 24 24' width='14'>
      <path
        d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='.6'
      />
    </svg>
  )
}
