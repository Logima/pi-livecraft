import type { SessionSummary } from '../../../shared/types.ts'

interface SubagentSessionBannerProps {
  parentSession?: SessionSummary
  parentSessionId: string
  onNavigate: (sessionId: string) => void
}

/** Identifies a delegated transcript and links back to the session that owns the flow. */
export function SubagentSessionBanner({
  parentSession,
  parentSessionId,
  onNavigate,
}: SubagentSessionBannerProps) {
  const parentName = parentSession?.name || 'parent session'
  return (
    <section aria-label='Subagent session' className='subagent-session-banner'>
      <span aria-hidden='true' className='subagent-session-banner-mark'>↳</span>
      <span className='subagent-session-banner-copy'>
        <strong>Subagent flow</strong>
        <span>Working for {parentName}</span>
      </span>
      <button
        className='subagent-session-banner-link'
        onClick={() => onNavigate(parentSessionId)}
        title={`Return to ${parentName}`}
        type='button'
      >
        Back to parent
      </button>
    </section>
  )
}
