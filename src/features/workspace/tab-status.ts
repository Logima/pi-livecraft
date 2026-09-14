/** Keeps exact counts ahead of the app name when browser tabs truncate their titles. */
export function tabTitle(running: number, waiting: number, unread: number): string {
  const counters = [
    running > 0 ? `▶${running}` : '',
    waiting > 0 ? `⚑${waiting}` : '',
    unread > 0 ? `✓${unread}` : '',
  ].filter(Boolean)
  return counters.length > 0 ? `${counters.join(' · ')} - Pi Livecraft` : 'Pi Livecraft'
}

/** Uses the favicon palette, a static running ring, and one legible unread count. */
export function tabIcon(running: number, waiting: number, unread: number): string {
  const attention = waiting + unread
  const label = attention > 9 ? '9+' : String(attention)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="17" fill="#1d2924"/>
    ${running ? `<circle cx="32" cy="32" r="28" fill="none" stroke="#8ba497" stroke-width="6"/>` : ''}
    ${attention
    ? `<text x="32" y="45" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${attention > 9 ? 34 : 42}" fill="#fff">${label}</text>`
    : '<path d="M20 22h24M25 22v21M39 22v21" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="6"/>'}
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
