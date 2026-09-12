/** Displays session cost, response speed, and context window usage with a progress bar. */
export function SessionStats(
  { cost, speed, contextClass, contextTokens, contextPercent, contextPercentValue }: {
    cost: string
    speed: string
    contextClass: string
    contextTokens: string
    contextPercent: string
    contextPercentValue: number | null
  },
) {
  return (
    <div className='composer-stats'>
      <span>
        <b>Cost</b>
        {cost}
      </span>
      <span>
        <b>Speed</b>
        {speed}
      </span>
      <span className={contextClass}>
        <b>Context</b>
        <small>{contextTokens}</small>
        {contextPercentValue !== null && (
          <>
            {contextPercent}
            <progress
              aria-label={`Context usage: ${contextTokens} (${contextPercent})`}
              max={100}
              value={contextPercentValue}
            />
          </>
        )}
      </span>
    </div>
  )
}
