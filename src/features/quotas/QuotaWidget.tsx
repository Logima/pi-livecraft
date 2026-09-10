import { useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { QuotaProviderSnapshot, QuotaSnapshot } from '../../../shared/types.ts'

/** Displays normalized quota readings without deducing absent quota from provider responses. */
export function QuotaWidget(
  { quotas, onRefresh }: { quotas: QuotaSnapshot | null; onRefresh: () => Promise<void> },
) {
  const [refreshing, setRefreshing] = useState(false)
  const updatedAt = Math.max(quotas?.openai.updatedAt ?? 0, quotas?.copilot.updatedAt ?? 0)

  /** Keeps the button disabled until the manual refresh completes, whether success or error. */
  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <header className='widget-header quota-header'>
        <div>
          <strong>Quotas</strong>
          <span>{updatedAt ? `Updated ${formatRelativeDate(updatedAt)}` : 'No reading'}</span>
        </div>
        <Tooltip label='Refresh'>
          <button
            aria-label='Refresh quotas'
            className='git-refresh'
            disabled={refreshing || quotas?.refreshing || quotas?.sessionRequired}
            onClick={() => void refresh()}
            type='button'
          >
            ↻
          </button>
        </Tooltip>
      </header>
      <div className='widget-content quota-content' aria-busy={refreshing || quotas?.refreshing}>
        {!quotas ? <QuotaSkeleton /> : (
          <>
            {quotas.sessionRequired && (
              <p className='quota-empty'>Open a Pi session to read quotas.</p>
            )}
            <ProviderSection name='OpenAI Codex' provider={quotas.openai}>
              {quotas.openai.data.map((window) => (
                <div className='quota-row' key={window.period}>
                  <div className='quota-row-copy'>
                    <strong>{window.period === '5h' ? '5-hour window' : '7-day window'}</strong>
                    <b>{formatPercent(window.remainingPercent)} remaining</b>
                  </div>
                  <QuotaBar
                    label={`${formatPercent(window.remainingPercent)} remaining`}
                    value={window.remainingPercent}
                  />
                  {window.resetsAt && (
                    <small title={`Reset at ${formatResetDate(window.resetsAt)}`}>
                      Reset in {formatResetDistance(window.resetsAt)}
                    </small>
                  )}
                </div>
              ))}
            </ProviderSection>
            <ProviderSection name='GitHub Copilot' provider={quotas.copilot}>
              {quotas.copilot.data.map((window) => (
                <div className='quota-row' key={window.name}>
                  <div className='quota-row-copy'>
                    <strong>{window.name}</strong>
                    <b>{formatNumber(window.used)} / {formatNumber(window.limit)}</b>
                  </div>
                  <QuotaBar
                    label={`${formatNumber(window.used)} used of ${formatNumber(window.limit)}`}
                    value={window.used / window.limit * 100}
                  />
                  {window.resetsAt && (
                    <small title={`Reset at ${formatResetDate(window.resetsAt)}`}>
                      Reset in {formatResetDistance(window.resetsAt)}
                    </small>
                  )}
                </div>
              ))}
            </ProviderSection>
          </>
        )}
      </div>
    </>
  )
}

function ProviderSection(
  { children, name, provider }: {
    children: React.ReactNode
    name: string
    provider: QuotaProviderSnapshot<unknown>
  },
) {
  return (
    <section className='quota-provider' aria-label={name}>
      <div className='quota-provider-heading'>
        <h2>{name}</h2>
        {provider.stale && <span>Stale reading</span>}
      </div>
      {children}
      {provider.data.length === 0 && !provider.error && (
        <p className='quota-provider-empty'>No quota data available.</p>
      )}
      {provider.error && <p className='quota-error' role='status'>{provider.error}</p>}
    </section>
  )
}

function QuotaBar({ label, value }: { label: string; value: number }) {
  const bounded = Math.min(100, Math.max(0, value))
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(bounded)}
      className='quota-bar'
      role='progressbar'
    >
      <span style={{ width: `${bounded}%` }} />
    </div>
  )
}

function QuotaSkeleton() {
  return (
    <div aria-label='Loading quotas' className='quota-skeleton' role='status'>
      <span />
      <span />
      <span />
    </div>
  )
}

function formatRelativeDate(timestamp: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  return new Intl.DateTimeFormat(navigator.language, {
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
  })
    .format(timestamp)
}

function formatResetDistance(timestamp: number): string {
  const remainingHours = Math.max(0, Math.floor((timestamp - Date.now()) / 3_600_000))
  const days = Math.floor(remainingHours / 24)
  const hours = remainingHours % 24
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

function formatResetDate(timestamp: number): string {
  const date = new Date(timestamp)
  const day = date.getDate()
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} ${hours}:${minutes}`
}

function formatPercent(value: number): string {
  return `${
    new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 }).format(value)
  } %`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 0 }).format(value)
}
