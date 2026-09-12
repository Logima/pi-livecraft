import { lazy, memo, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyablePre } from './CodeBlock.tsx'
import { workspaceFileUrl } from '../../api.ts'
import { parseMarkdownFrontmatter } from './markdown-frontmatter.ts'

const LazyCodeHighlighter = lazy(() => import('./CodeHighlighter'))
const languageAliases: Record<string, string> = {
  cs: 'csharp',
  html: 'markup',
  js: 'javascript',
  md: 'markdown',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  xml: 'markup',
  zsh: 'bash',
}
const highlightedLanguages = new Set([
  'bash',
  'csharp',
  'css',
  'javascript',
  'json',
  'markdown',
  'markup',
  'typescript',
])

/** Defers syntax highlighting until a fenced block approaches the viewport. */
function MarkdownCode({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)
  const rawLanguage = /(?:^|\s)language-([^\s]+)/.exec(className ?? '')?.[1]?.toLowerCase()
  const language = rawLanguage ? languageAliases[rawLanguage] ?? rawLanguage : undefined
  const canHighlight = Boolean(language && highlightedLanguages.has(language))

  useEffect(() => {
    if (!canHighlight || isNearViewport) return
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setIsNearViewport(true)
      },
      { rootMargin: '800px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [canHighlight, isNearViewport])

  const plainCode = <code className={className} ref={ref}>{children}</code>
  if (!canHighlight || !isNearViewport) return plainCode
  return (
    <Suspense fallback={plainCode}>
      <LazyCodeHighlighter
        className={className}
        CodeTag='span'
        customStyle={{
          background: 'transparent',
          font: 'inherit',
          margin: 0,
          padding: 0,
          whiteSpace: 'inherit',
        }}
        language={language}
        PreTag='code'
        wrapLongLines
      >
        {String(children ?? '')}
      </LazyCodeHighlighter>
    </Suspense>
  )
}

/** Renders conversation Markdown and optionally exposes validated front matter as a table. */
export const Markdown = memo(function Markdown(
  {
    children,
    copyablePre = false,
    onError,
    renderFrontmatter = false,
    workspacePath,
  }: {
    children: string
    copyablePre?: boolean
    onError?: (cause: unknown) => void
    renderFrontmatter?: boolean
    workspacePath?: string
  },
) {
  const frontmatter = renderFrontmatter ? parseMarkdownFrontmatter(children) : null
  const body = frontmatter?.body ?? children

  return (
    <>
      {frontmatter && frontmatter.entries.length > 0 && (
        <table className='tool-call-frontmatter'>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {frontmatter.entries.map(({ key, value }) => (
              <tr key={key}>
                <th scope='row'>{key}</th>
                <td>
                  <code className='tool-call-frontmatter-value'>{value}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ReactMarkdown
        components={{
          a: ({ href, children, ...props }) => (
            <a href={workspaceRelativeFileUrl(href, workspacePath)} {...props}>{children}</a>
          ),
          code: ({ children: code, className }) => (
            <MarkdownCode className={className}>{code}</MarkdownCode>
          ),
          img: ({ src, alt, ...props }) => (
            <img alt={alt ?? ''} src={workspaceRelativeFileUrl(src, workspacePath)} {...props} />
          ),
          pre: ({ children: code }) =>
            copyablePre
              ? <CopyablePre onError={onError}>{code}</CopyablePre>
              : <pre>{code}</pre>,
        }}
        remarkPlugins={[remarkGfm]}
      >
        {body}
      </ReactMarkdown>
    </>
  )
})

/** Rewrites workspace-relative Markdown URLs to the validated local file endpoint. */
function workspaceRelativeFileUrl(value: string | undefined, workspacePath: string | undefined): string | undefined {
  if (!value || !workspacePath || value.startsWith('#') || value.startsWith('//')) return value
  try {
    const url = new URL(value, 'http://localhost/')
    if (url.protocol !== 'http:' || url.hostname !== 'localhost') return value
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!path) return value
    return `${workspaceFileUrl(workspacePath, path)}${url.hash}`
  } catch {
    return value
  }
}
