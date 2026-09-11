const SESSION_QUERY_PARAMETER = 'session'

/** Reads the selected session identifier from the browser URL. */
export function readSessionIdFromUrl(): string {
  return new URLSearchParams(window.location.search).get(SESSION_QUERY_PARAMETER) ?? ''
}

/** Returns the URL with the selected session represented without changing its path. */
export function urlForSession(sessionId: string): string {
  const url = new URL(window.location.href)
  if (sessionId) url.searchParams.set(SESSION_QUERY_PARAMETER, sessionId)
  else url.searchParams.delete(SESSION_QUERY_PARAMETER)
  return `${url.pathname}${url.search}${url.hash}`
}
