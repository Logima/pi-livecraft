import type { SessionSummary } from '../../../shared/types.ts'
import { urlForSession } from '../workspace/session-url.ts'

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
    <a
      aria-label={`Subagent flow for ${parentName}. Return to parent session`}
      className='subagent-session-banner'
      href={urlForSession(parentSessionId)}
      onClick={(event) => {
        event.preventDefault()
        onNavigate(parentSessionId)
      }}
      title={`Return to ${parentName}`}
    >
      <span aria-hidden='true' className='subagent-session-banner-mark'>↳</span>
      <span className='subagent-session-banner-copy'>
        <strong>Subagent flow</strong>
        <span>Working for {parentName}</span>
      </span>
      <span aria-hidden='true' className='subagent-session-banner-arrow'>↗</span>
    </a>
  )
}
