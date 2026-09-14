import { useEffect } from 'react'
import { tabIcon, tabTitle } from './tab-status.ts'

/** Updates browser chrome independently of rendering; static counts survive background throttling. */
export function useTabStatus(running: number, waiting: number, unread: number): void {
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const originalTitle = document.title
    const originalHref = icon?.getAttribute('href')
    document.title = tabTitle(running, waiting, unread)
    if (icon) {
      icon.href = running || unread
        ? tabIcon(running, waiting, unread)
        : originalHref ?? '/favicon.svg'
    }
    return () => {
      document.title = originalTitle
      if (icon && originalHref !== null && originalHref !== undefined) {
        icon.setAttribute('href', originalHref)
      }
    }
  }, [running, waiting, unread])
}
