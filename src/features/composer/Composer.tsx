import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  JsonObject,
  PromptTemplate,
  SessionSnapshot,
  SessionSummary,
} from '../../../shared/types.ts'
import { maxComposerImages, prepareComposerImage, type ComposerImage } from './composer-images.ts'
import {
  commandTakesArguments,
  ensureCompactCommand,
  ensureSessionCommands,
  formatTokens,
  isCommandDraft,
  isCompactCommandDraft,
  isNewSessionCommandDraft,
  isObject,
  readComposerDraft,
} from './composer-utils.ts'
import { AgentSelect } from './selects/AgentSelect.tsx'
import { BehaviorSelect } from './selects/BehaviorSelect.tsx'
import { ModelSelect } from './selects/ModelSelect.tsx'
import { PromptSelect } from './selects/PromptSelect.tsx'
import { ThinkingSelect } from './selects/ThinkingSelect.tsx'
import { ComposerSelect } from './selects/ComposerSelect.tsx'
import { ComposerStatusBar } from './status-bar/ComposerStatusBar.tsx'

/** Static options for the Improve-prompt dropdown; hoisted to a module constant so the select never re-renders for it. */
const improveOptions = [
  { label: 'Clarify', value: 'clarify' },
  { label: 'Ideate', value: 'ideate' },
  { label: 'Precise', value: 'precise' },
]

/** Provides user input and session commands while reflecting the current Pi state. */
export const Composer = memo(function Composer({
  session,
  snapshot,
  agentBusy,
  agentOptions,
  agentOptionsLoading,
  selectedAgent,
  agentLoading,
  showAgentSelector,
  onAgentChange,
  onRequestAgentOptions,
  onCommand,
  onNewSession,
  commands,
  running,
  compacting,
  onSend,
  onAbort,
  onImprovePrompt,
  onSavePrompt,
  onError,
  requestedSelect,
  onSelectOpened,
  submitRequest = 0,
  focusRequest,
  draftRequest,
  onDraftApplied,
}: {
  session: SessionSummary
  snapshot: SessionSnapshot
  agentBusy: boolean
  agentOptions: string[]
  agentOptionsLoading: boolean
  selectedAgent: string
  agentLoading: boolean
  showAgentSelector: boolean
  onAgentChange: (agent: string) => void
  onRequestAgentOptions: () => void
  onCommand: (command: JsonObject) => Promise<JsonObject>
  onNewSession: () => Promise<void>
  commands: JsonObject[]
  running: boolean
  compacting: boolean
  onSend: (
    message: string,
    images: JsonObject[],
    behavior: 'steer' | 'followUp',
    isCommand: boolean,
  ) => Promise<void>
  onAbort: () => Promise<JsonObject>
  onImprovePrompt: (
    prompt: string,
    direction?: string,
  ) => Promise<{ prompt: string; cost?: number }>
  onSavePrompt: (
    scope: 'global' | 'project',
    name: string,
    content: string,
  ) => Promise<PromptTemplate>
  onError: (cause: unknown) => void
  requestedSelect?: 'agent' | 'model' | 'thinking' | null
  onSelectOpened?: () => void
  submitRequest?: number
  focusRequest?: number
  draftRequest?: { id: string; message: string }
  onDraftApplied?: (id: string) => void
}) {
  const draftStorageKey = `pi-livecraft.composer-draft.${session.id}`
  const [message, setMessage] = useState(() => readComposerDraft(draftStorageKey))
  const [images, setImages] = useState<ComposerImage[]>([])
  const [preparingImages, setPreparingImages] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [improving, setImproving] = useState(false)
  const [improvePreset, setImprovePreset] = useState('')
  const [previewingPrompt, setPreviewingPrompt] = useState(false)
  const [savedPrompts, setSavedPrompts] = useState<PromptTemplate[]>([])
  const [promptSave, setPromptSave] = useState<{
    content: string
    name: string
    scope: 'global' | 'project'
  }>()
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [suggestion, setSuggestion] = useState<
    { original: string; improved: string; cost?: number }
  >()
  const [openSelect, setOpenSelect] = useState<'agent' | 'model' | 'thinking' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const promptSaveDialogRef = useRef<HTMLDialogElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const promptPreviewOriginal = useRef<string | undefined>(undefined)
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null)
  const draftPersistTimerRef = useRef<number>(0)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(-1)
  const [behavior, setBehavior] = useState<'steer' | 'followUp'>('steer')
  const model = isObject(snapshot.state?.model) ? snapshot.state.model : null
  const currentModel = model && typeof model.id === 'string' && typeof model.provider === 'string'
    ? `${model.provider}/${model.id}`
    : ''
  const selectedModel = snapshot.models.find((item) =>
    `${item.provider}/${item.id}` === currentModel
  )
  const modelInput = selectedModel?.input ?? model?.input
  const supportsImages = Array.isArray(modelInput) && modelInput.includes('image')
  const thinking = typeof snapshot.state?.thinkingLevel === 'string'
    ? snapshot.state.thinkingLevel
    : 'off'
  // Keep a ref to the latest draft so stable callbacks can read it without re-creating on every keystroke.
  const messageRef = useRef(message)
  messageRef.current = message
  /** Snapshot commands augmented with local commands when Pi doesn't expose them. */
  const allCommands = ensureSessionCommands(ensureCompactCommand(commands))
  const commandPending = isCommandDraft(message, allCommands)
  const promptTemplates = useMemo(() =>
    [...savedPrompts, ...snapshot.promptTemplates].filter((
      prompt,
      index,
      all,
    ) => all.findIndex((candidate) => candidate.name === prompt.name) === index), [
    savedPrompts,
    snapshot.promptTemplates,
  ])

  // Stable open-change handlers so memoized selects never re-render on a keystroke.
  const handleAgentOpenChange = useCallback(
    (open: boolean) => setOpenSelect(open ? 'agent' : null),
    [],
  )
  const handleModelOpenChange = useCallback(
    (open: boolean) => setOpenSelect(open ? 'model' : null),
    [],
  )
  const handleThinkingOpenChange = useCallback(
    (open: boolean) => setOpenSelect(open ? 'thinking' : null),
    [],
  )
  const handlePromptOpenChange = useCallback(() => setOpenSelect(null), [])

  useEffect(() => {
    if (submitRequest > 0) formRef.current?.requestSubmit()
  }, [submitRequest])

  useEffect(() => {
    if (promptSave && !promptSaveDialogRef.current?.open) promptSaveDialogRef.current?.showModal()
  }, [promptSave])

  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    if ((focusRequest ?? 0) > 0) textareaRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (!requestedSelect) return
    if (requestedSelect === 'agent' && agentOptions.length === 0) {
      onRequestAgentOptions()
      return
    }
    setOpenSelect(requestedSelect)
    const trigger = requestedSelect === 'agent'
      ? agentTriggerRef.current
      : requestedSelect === 'model'
      ? modelTriggerRef.current
      : thinkingTriggerRef.current
    trigger?.focus()
    onSelectOpened?.()
  }, [onSelectOpened, requestedSelect, agentOptions.length, onRequestAgentOptions])

  useEffect(() => {
    if (!draftRequest) return
    setDraftMessage(draftRequest.message)
    textareaRef.current?.focus()
    onDraftApplied?.(draftRequest.id)
  }, [draftRequest, onDraftApplied])

  // Place the caret at the end when the browser restores focus on refresh.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea && document.activeElement === textarea) {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
  }, [])

  /** Persists the draft to storage, tolerating unavailable storage (private browsing). */
  const persistDraft = useCallback((text: string): void => {
    try {
      if (text) window.localStorage.setItem(draftStorageKey, text)
      else window.localStorage.removeItem(draftStorageKey)
    } catch {
      // Storage can be unavailable in private browsing; the in-memory draft still works.
    }
  }, [draftStorageKey])

  // Flush the pending draft on unmount so switching sessions within the debounce window cannot drop the write.
  // During a prompt preview messageRef holds the preview text; prefer the saved original so the preview is never persisted.
  useEffect(() => {
    return () => {
      if (draftPersistTimerRef.current) {
        window.clearTimeout(draftPersistTimerRef.current)
        persistDraft(promptPreviewOriginal.current ?? messageRef.current)
      }
    }
  }, [persistDraft])

  /** Available commands filtered by the text after the slash. */
  const filteredCommands = allCommands.filter((command) =>
    slashOpen && String(command.name).toLowerCase().includes(slashFilter.toLowerCase())
  )

  useLayoutEffect(() => {
    const selectedCommand = formRef.current?.querySelector<HTMLElement>(
      '.slash-commands [aria-selected="true"]',
    )
    selectedCommand?.scrollIntoView({ block: 'nearest' })
  }, [slashFilter, slashIndex])

  useEffect(() => {
    if (!slashOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      const dropdown = formRef.current?.querySelector<HTMLElement>('.slash-commands')
      if (dropdown?.contains(event.target)) return
      setSlashOpen(false)
      setSlashIndex(-1)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [slashOpen])

  /** Updates the visible draft immediately and persists it on a debounce so typing never blocks on storage I/O. */
  const setDraftMessage = useCallback((nextMessage: string): void => {
    setMessage(nextMessage)
    messageRef.current = nextMessage
    window.clearTimeout(draftPersistTimerRef.current)
    draftPersistTimerRef.current = window.setTimeout(() => {
      persistDraft(nextMessage)
      draftPersistTimerRef.current = 0
    }, 400)
  }, [persistDraft])

  /** Inserts an argument-taking command or executes a complete no-argument command. */
  function selectSlashCommand(command: JsonObject): void {
    const name = String(command.name)
    setSlashOpen(false)
    setSlashIndex(-1)
    if (commandTakesArguments(command)) {
      setDraftMessage(`/${name} `)
      return
    }
    void submitMessage(`/${name}`)
  }

  /** Shows a template without persisting it, retaining the existing draft until a selection is made. */
  const previewPrompt = useCallback((prompt: PromptTemplate): void => {
    if (promptPreviewOriginal.current === undefined)
      promptPreviewOriginal.current = messageRef.current
    setPreviewingPrompt(true)
    setMessage(prompt.content)
  }, [])

  /** Restores the draft when a prompt menu preview ends without an explicit selection. */
  const endPromptPreview = useCallback((): void => {
    if (promptPreviewOriginal.current === undefined) return
    setMessage(promptPreviewOriginal.current)
    messageRef.current = promptPreviewOriginal.current
    promptPreviewOriginal.current = undefined
    setPreviewingPrompt(false)
  }, [])

  /** Replaces and persists the draft after a prompt template has been explicitly selected. */
  const selectPrompt = useCallback((prompt: PromptTemplate): void => {
    promptPreviewOriginal.current = undefined
    setPreviewingPrompt(false)
    setDraftMessage(prompt.content)
    textareaRef.current?.focus()
  }, [setDraftMessage])

  /** Opens a blank naming dialog for the selected Pi prompt scope. */
  const openPromptSaveDialog = useCallback((scope: 'global' | 'project'): void => {
    setPromptSave({ content: messageRef.current, name: '', scope })
  }, [])

  /** Persists the named template while keeping the dialog open when the backend rejects it. */
  async function savePrompt(): Promise<void> {
    if (!promptSave || savingPrompt) return
    if (!promptSaveDialogRef.current?.querySelector('input')?.reportValidity()) return
    setSavingPrompt(true)
    try {
      const saved = await onSavePrompt(promptSave.scope, promptSave.name, promptSave.content)
      setSavedPrompts((current) => [
        saved,
        ...current.filter((prompt) => prompt.name !== saved.name),
      ])
      promptSaveDialogRef.current?.close()
      setPromptSave(undefined)
    } catch (cause) {
      onError(cause)
    } finally {
      setSavingPrompt(false)
    }
  }

  /** Sends text and images in the same RPC command, restoring the draft on failure. */
  async function submitMessage(nextMessage: string): Promise<void> {
    if (preparingImages || (!nextMessage && images.length === 0)) return
    if (images.length > 0 && !supportsImages) {
      onError('The selected model does not accept images.')
      return
    }
    setSubmitting(true)
    setSuggestion(undefined)
    setDraftMessage('')
    setImages([])
    try {
      if (isCompactCommandDraft(nextMessage)) {
        await onCommand({ type: 'compact' })
        return
      }
      if (isNewSessionCommandDraft(nextMessage)) {
        await onNewSession()
        return
      }
      await onSend(
        nextMessage,
        images.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })),
        behavior,
        commandPending,
      )
    } catch (cause) {
      setDraftMessage(nextMessage)
      setImages(images)
      onError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await submitMessage(message.trim())
  }

  /** Produces an isolated rewrite while preserving the source text for an explicit comparison. */
  const improveDraft = useCallback(async (direction?: string): Promise<void> => {
    const original = messageRef.current.trim()
    if (!original || improving) return
    setImproving(true)
    setSuggestion(undefined)
    try {
      const result = await onImprovePrompt(original, direction)
      setSuggestion({ original, improved: result.prompt, cost: result.cost })
    } catch (cause) {
      onError(cause)
    } finally {
      setImproving(false)
      setImprovePreset('')
    }
  }, [improving, onImprovePrompt, onError])

  /** Triggers an isolated rewrite when the user picks an Improve preset. */
  const handleImproveValueChange = useCallback((value: string) => {
    setImprovePreset(value)
    void improveDraft(value)
  }, [improveDraft])

  /** Prepares pasted images locally to bound the HTTP body and context sent to the model. */
  async function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/')
    )
    if (files.length === 0 || submitting) return
    event.preventDefault()
    const pastedText = event.clipboardData.getData('text/plain')
    const { selectionEnd, selectionStart } = event.currentTarget
    if (pastedText)
      setDraftMessage(
        `${message.slice(0, selectionStart)}${pastedText}${message.slice(selectionEnd)}`,
      )

    const remaining = maxComposerImages - images.length
    if (remaining <= 0) {
      onError(`A message can contain at most ${maxComposerImages} images.`)
      return
    }
    setPreparingImages(true)
    try {
      const prepared = await Promise.all(files.slice(0, remaining).map(prepareComposerImage))
      const accepted = prepared.filter((image): image is ComposerImage => image !== null)
      setImages((current) => [...current, ...accepted].slice(0, maxComposerImages))
      if (accepted.length !== files.length)
        onError(`Some images could not be prepared (maximum: ${maxComposerImages}).`)
    } catch (cause) {
      onError(cause)
    } finally {
      setPreparingImages(false)
    }
  }

  const stats = snapshot.stats
  const contextUsage = stats?.contextUsage
  const contextPercentValue = typeof contextUsage?.percent === 'number'
    ? Math.round(contextUsage.percent)
    : null
  const contextPercent = contextPercentValue === null ? '—' : `${contextPercentValue}%`
  const contextTokens = typeof contextUsage
          ?.tokens === 'number' && typeof contextUsage.contextWindow === 'number'
    ? `${formatTokens(contextUsage.tokens)}/${formatTokens(contextUsage.contextWindow)}`
    : 'Unavailable'
  const cost = typeof stats?.cost === 'number' ? `$${stats.cost.toFixed(2)}` : '—'
  const contextClass = typeof contextUsage?.percent === 'number'
    ? contextUsage.percent >= 40
      ? 'context-danger'
      : contextUsage.percent >= 30
      ? 'context-warning-strong'
      : contextUsage.percent >= 20
      ? 'context-warning'
      : ''
    : ''

  return (
    <form
      className={`composer${previewingPrompt ? ' previewing-prompt' : ''}`}
      onSubmit={(event) => void submit(event)}
      ref={formRef}
    >
      {images.length > 0 && (
        <div aria-label='Images to send' className='composer-images'>
          {images.map((image, index) => (
            <div className='composer-image' key={image.id}>
              <img
                alt={`Image ${index + 1} to send`}
                src={`data:${image.mimeType};base64,${image.data}`}
              />
              <button
                aria-label={`Remove image ${index + 1}`}
                disabled={submitting}
                onClick={() => setImages((current) => current.filter(({ id }) => id !== image.id))}
                type='button'
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {slashOpen && filteredCommands.length > 0 && (
        <div className='slash-commands' role='listbox'>
          {filteredCommands.map((command, index) => (
            <div
              aria-selected={index === slashIndex}
              className={`slash-command-item${index === slashIndex ? ' selected' : ''}`}
              key={String(command.name)}
              onClick={() => selectSlashCommand(command)}
              onMouseDown={(event) => event.preventDefault()}
              role='option'
            >
              <span className='slash-command-name'>/{String(command.name)}</span>
              {typeof command.description === 'string' && (
                <span className='slash-command-desc'>{command.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <textarea
        aria-label='Message'
        disabled={submitting}
        onPaste={(event) => void handlePaste(event)}
        ref={textareaRef}
        value={message}
        onChange={(event) => {
          const next = event.target.value
          setDraftMessage(next)
          if (next.startsWith('/') && allCommands.length > 0) {
            setSlashOpen(true)
            setSlashFilter(next.slice(1))
            setSlashIndex(0)
          } else {
            setSlashOpen(false)
          }
        }}
        onKeyDown={(event) => {
          if (slashOpen && filteredCommands.length > 0) {
            if (event.key === 'Escape') {
              event.preventDefault()
              setSlashOpen(false)
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSlashIndex((index) => Math.min(index + 1, filteredCommands.length - 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSlashIndex((index) => Math.max(index - 1, 0))
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const target = slashIndex >= 0 ? filteredCommands[slashIndex] : filteredCommands[0]
              if (target) selectSlashCommand(target)
              return
            }
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder='Ask Pi…  / for commands'
        rows={3}
      />
      {suggestion && (
        <section
          aria-label='Prompt improvement suggestion'
          aria-live='polite'
          className='prompt-suggestion'
        >
          <div className='prompt-comparison'>
            <div>
              <strong>Original</strong>
              <p>{suggestion.original}</p>
            </div>
            <div>
              <strong>Suggestion</strong>
              <p>{suggestion.improved}</p>
            </div>
          </div>
          <div className='prompt-suggestion-meta'>
            {suggestion.cost !== undefined && (
              <span className='prompt-improvement-cost'>
                Improvement cost: ${suggestion.cost.toFixed(4)}
              </span>
            )}
          </div>
          <div className='prompt-suggestion-actions'>
            <button
              onClick={() => {
                setSuggestion(undefined)
                textareaRef.current?.focus()
              }}
              type='button'
            >
              Ignore
            </button>
            <button
              className='accept'
              onClick={() => {
                setDraftMessage(suggestion.improved)
                setSuggestion(undefined)
                textareaRef.current?.focus()
              }}
              type='button'
            >
              Use suggestion
            </button>
          </div>
        </section>
      )}
      <div className='composer-footer'>
        <div className='composer-actions'>
          <div className='composer-tools'>
            {showAgentSelector && (
              <AgentSelect
                agentOptions={agentOptions}
                selectedAgent={selectedAgent}
                agentLoading={agentLoading}
                agentBusy={agentBusy || agentOptionsLoading}
                onAgentChange={onAgentChange}
                onRequestOptions={onRequestAgentOptions}
                open={openSelect === 'agent'}
                onOpenChange={handleAgentOpenChange}
                triggerRef={agentTriggerRef}
              />
            )}
            <ModelSelect
              models={snapshot.models}
              currentModel={currentModel}
              onCommand={onCommand}
              onError={onError}
              open={openSelect === 'model'}
              onOpenChange={handleModelOpenChange}
              triggerRef={modelTriggerRef}
            />
            <ThinkingSelect
              thinking={thinking}
              onCommand={onCommand}
              onError={onError}
              open={openSelect === 'thinking'}
              onOpenChange={handleThinkingOpenChange}
              triggerRef={thinkingTriggerRef}
            />
            <Tooltip label='Insert a configured prompt'>
              <PromptSelect
                canSave={Boolean(message.trim()) && !previewingPrompt}
                onOpenChange={handlePromptOpenChange}
                onPreview={previewPrompt}
                onPreviewEnd={endPromptPreview}
                onSave={openPromptSaveDialog}
                onSelect={selectPrompt}
                prompts={promptTemplates}
              />
            </Tooltip>

            {running && <BehaviorSelect behavior={behavior} onChange={setBehavior} />}
            <Tooltip label='Improve prompt'>
              <ComposerSelect
                ariaLabel='Improve prompt'
                disabled={improving || submitting || !message.trim()}
                onValueChange={handleImproveValueChange}
                options={improveOptions}
                loading={improving}
                placeholder='Improve'
                tone='improve'
                value={improvePreset}
              />
            </Tooltip>
          </div>
          <div className='composer-primary-actions'>
            <span className='composer-stop-slot'>
              {running && (
                <Tooltip label='Stop generation'>
                  <button
                    aria-label='Stop generation'
                    className='icon-button danger'
                    onClick={() => void onAbort().catch(onError)}
                    type='button'
                  >
                    <svg aria-hidden='true' viewBox='0 0 16 16'>
                      <rect height='8' rx='1.5' width='8' x='4' y='4' />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </span>
            <Tooltip label={commandPending ? 'Run command (Enter)' : 'Send message (Enter)'}>
              <button
                aria-label={commandPending ? 'Run command' : 'Send message'}
                className={`icon-button send${commandPending ? ' command' : ''}`}
                disabled={submitting || preparingImages
                  || (!message.trim() && images.length === 0)}
                type='submit'
              >
                {commandPending
                  ? (
                    <svg aria-hidden='true' viewBox='0 0 16 16'>
                      <path d='M9.2 1.5 3.5 8.4h3.2l-.3 6.1 6.1-7.4H9.1l.1-5.6Z' />
                    </svg>
                  )
                  : (
                    <svg aria-hidden='true' viewBox='0 0 16 16'>
                      <path d='m2.5 2.5 11 5.5-11 5.5 1.8-5.1L9 8 4.3 7.6z' />
                    </svg>
                  )}
              </button>
            </Tooltip>
          </div>
        </div>
        <ComposerStatusBar
          session={session}
          running={running}
          compacting={compacting}
          cost={cost}
          contextClass={contextClass}
          contextTokens={contextTokens}
          contextPercent={contextPercent}
          contextPercentValue={contextPercentValue}
        />
      </div>
      {promptSave && (
        <dialog
          aria-labelledby='prompt-save-title'
          className='prompt-save-dialog'
          onCancel={(event) => {
            if (savingPrompt) event.preventDefault()
            else setPromptSave(undefined)
          }}
          onClose={() => setPromptSave(undefined)}
          ref={promptSaveDialogRef}
        >
          <div>
            <header>
              <span>{promptSave.scope === 'global' ? 'Global prompt' : 'Project prompt'}</span>
              <h2 id='prompt-save-title'>Save prompt</h2>
              <p>
                {promptSave.scope === 'global'
                  ? '~/.pi/agent/prompts/<name>.md'
                  : '.pi/prompts/<name>.md'}
              </p>
            </header>
            <label htmlFor='prompt-save-name'>Prompt name</label>
            <input
              aria-describedby='prompt-save-hint'
              autoFocus
              id='prompt-save-name'
              maxLength={80}
              onChange={(event) => setPromptSave({ ...promptSave, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void savePrompt()
              }}
              pattern='[A-Za-z0-9][A-Za-z0-9_-]{0,79}'
              required
              spellCheck={false}
              value={promptSave.name}
            />
            <small id='prompt-save-hint'>
              Letters, numbers, hyphens, and underscores. This becomes the /command name.
            </small>
            <div className='prompt-save-actions'>
              <button
                disabled={savingPrompt}
                onClick={() => promptSaveDialogRef.current?.close()}
                type='button'
              >
                Cancel
              </button>
              <button
                className='primary'
                disabled={savingPrompt}
                onClick={() => void savePrompt()}
                type='button'
              >
                {savingPrompt ? 'Saving…' : 'Save prompt'}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </form>
  )
})
