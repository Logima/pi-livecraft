import { createReadStream } from 'node:fs'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { RecentSession } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const sessionDirectory = resolvePiSessionDirectory(process.env, homedir())

/** Resolves Pi's session storage using its configured profile before the default profile. */
export function resolvePiSessionDirectory(
  environment: { PI_CODING_AGENT_SESSION_DIR?: string; PI_CODING_AGENT_DIR?: string },
  homeDirectory: string,
): string {
  return environment.PI_CODING_AGENT_SESSION_DIR
    ?? (environment.PI_CODING_AGENT_DIR
      ? join(environment.PI_CODING_AGENT_DIR, 'sessions')
      : join(homeDirectory, '.pi', 'agent', 'sessions'))
}

interface PiSessionHeader {
  type: 'session'
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
}

const MAX_SESSIONS = 30
const CANDIDATE_BUFFER = 100
const HEAD_CHUNK_BYTES = 64 * 1024
const TAIL_CHUNK_BYTES = 64 * 1024
const TAIL_SCAN_BUDGET = 2 * 1024 * 1024

interface AgentDescriptionCacheEntry {
  descriptions: Map<string, string>
  offset: number
}

const agentDescriptionCache = new Map<string, AgentDescriptionCacheEntry>()

/** Reads only the metadata required to resume a Pi session. */
export async function listRecentPiSessions(
  cwd: string,
  directory = sessionDirectory,
): Promise<RecentSession[]> {
  const paths = await listSessionFiles(directory)

  // stat is cheap, readFile is expensive: read only the most recent candidates
  const withMtime = await Promise.all(
    paths.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
  )
  const candidates = withMtime
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, CANDIDATE_BUFFER)

  const sessions = await Promise.all(
    candidates.map(({ path, mtime }) => readPiSession(path, mtime)),
  )
  const loadedByPath = new Map(
    sessions.flatMap((session) => session ? [[session.sessionPath, session] as const] : []),
  )
  const availablePaths = new Set(paths)
  const attemptedParentPaths = new Set<string>()
  let missingParentPaths = parentPathsToLoad(loadedByPath, availablePaths, attemptedParentPaths)
  while (missingParentPaths.length > 0) {
    for (const path of missingParentPaths) attemptedParentPaths.add(path)
    const parents = await Promise.all(
      missingParentPaths.map(async (path) => readPiSession(path, (await stat(path)).mtimeMs)),
    )
    for (const parent of parents) {
      if (parent) loadedByPath.set(parent.sessionPath, parent)
    }
    missingParentPaths = parentPathsToLoad(loadedByPath, availablePaths, attemptedParentPaths)
  }

  const workspaceSessions = [...loadedByPath.values()].filter((session) => session.cwd === cwd)
  const workspacePaths = new Set(workspaceSessions.map((session) => session.sessionPath))
  // A busy child keeps its collapsed root recent even when the parent's own file is older.
  const latestActivityByPath = new Map(
    workspaceSessions.map((session) => [session.sessionPath, session.updatedAt]),
  )
  for (const session of workspaceSessions) {
    const visited = new Set<string>()
    let parentPath = session.parentSessionPath
    while (parentPath && workspacePaths.has(parentPath) && !visited.has(parentPath)) {
      visited.add(parentPath)
      latestActivityByPath.set(
        parentPath,
        Math.max(latestActivityByPath.get(parentPath) ?? 0, session.updatedAt),
      )
      parentPath = loadedByPath.get(parentPath)?.parentSessionPath
    }
  }
  const rootPaths = workspaceSessions
    .filter((session) =>
      !session.parentSessionPath || !workspacePaths.has(session.parentSessionPath)
    )
    .sort((left, right) =>
      (latestActivityByPath.get(right.sessionPath) ?? right.updatedAt)
      - (latestActivityByPath.get(left.sessionPath) ?? left.updatedAt)
    )
    .slice(0, MAX_SESSIONS)
    .map((session) => session.sessionPath)
  const includedPaths = new Set(rootPaths)
  let addedChild = true
  while (addedChild) {
    addedChild = false
    for (const session of workspaceSessions) {
      if (
        !includedPaths.has(session.sessionPath)
        && session.parentSessionPath
        && includedPaths.has(session.parentSessionPath)
      ) {
        includedPaths.add(session.sessionPath)
        addedChild = true
      }
    }
  }
  const selectedSessions = workspaceSessions
    .filter((session) => includedPaths.has(session.sessionPath))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  return addRelatedSessionDisplayNames(selectedSessions)
}

/** Verifies that a file belongs to the Pi session directory before loading its metadata. */
export async function loadPiSession(path: string): Promise<RecentSession> {
  const [canonicalPath, canonicalDirectory] = await Promise.all([
    realpath(path),
    realpath(sessionDirectory),
  ])
  const relativePath = relative(canonicalDirectory, canonicalPath)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error('Pi session file must be stored in the Pi session directory')
  const session = await readPiSession(canonicalPath, (await stat(canonicalPath)).mtimeMs)
  if (!session) throw new Error('Invalid Pi session file')
  return session
}

/** Recursively scans Pi storage while retaining only session JSONL files. */
async function listSessionFiles(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }

  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSessionFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

/** Extracts a session's identity, name, and latest activity without loading its full history. */
async function readPiSession(path: string, updatedAt: number): Promise<RecentSession | null> {
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    return null
  }
  let lines: string[]
  try {
    lines = await readSessionLines(canonicalPath)
  } catch {
    return null
  }

  const header = parseHeader(lines[0])
  if (!header) return null
  let cwd: string
  try {
    cwd = await realpath(header.cwd)
  } catch {
    return null
  }
  let hasMessage = false
  let name: string | undefined
  let prompt: string | undefined
  let lastMessageAt: number | undefined
  for (let index = 1; index < lines.length; index += 1) {
    const value = parseLine(lines[index])
    if (!value) continue
    if (value.type === 'session_info' && typeof value.name === 'string' && value.name.trim()) {
      name = value.name.trim()
      continue
    }
    if (value.type !== 'message') continue
    hasMessage = true
    if (typeof value.timestamp === 'string') {
      const timestamp = Date.parse(value.timestamp)
      if (!Number.isNaN(timestamp) && (lastMessageAt === undefined || timestamp > lastMessageAt))
        lastMessageAt = timestamp
    }
    if (prompt === undefined && isObject(value.message) && value.message.role === 'user') {
      const content = textContent(value.message.content)
      if (content && !content.startsWith('/')) prompt = shortenPrompt(content)
    }
  }
  if (!hasMessage) return null
  let parentSessionPath: string | undefined
  if (header.parentSession) {
    try {
      parentSessionPath = await realpath(header.parentSession)
    } catch {
      parentSessionPath = header.parentSession
    }
  }
  const createdAt = Date.parse(header.timestamp)
  return {
    id: header.id,
    cwd,
    name: name || prompt || 'New session',
    sessionPath: canonicalPath,
    parentSessionPath,
    updatedAt: lastMessageAt ?? (Number.isNaN(createdAt) ? updatedAt : createdAt),
  }
}

/** Reads only the head and the newest entries of a session file instead of its full history:
 *  the header, name, and first prompt live near the start, and the newest activity at the end.
 *  Gigabytes of middle history never need to be parsed to render the recent-session list.
 *  A single entry may itself be huge (tool outputs), so the end is scanned backward in chunks
 *  until a complete JSON line is found rather than assuming a fixed tail fits. */
async function readSessionLines(path: string): Promise<string[]> {
  const size = (await stat(path)).size
  if (size <= HEAD_CHUNK_BYTES + TAIL_CHUNK_BYTES) return (await readFile(path, 'utf8')).split('\n')
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const head = Buffer.alloc(HEAD_CHUNK_BYTES)
    const { bytesRead: headBytes } = await handle.read(head, 0, HEAD_CHUNK_BYTES, 0)
    let tail = ''
    let position = size
    let scanned = 0
    while (position > HEAD_CHUNK_BYTES && scanned < TAIL_SCAN_BUDGET && !hasParseableLine(tail)) {
      const chunkSize = Math.min(TAIL_CHUNK_BYTES, position - HEAD_CHUNK_BYTES)
      position -= chunkSize
      const chunk = Buffer.alloc(chunkSize)
      const { bytesRead } = await handle.read(chunk, 0, chunkSize, position)
      tail = chunk.subarray(0, bytesRead).toString('utf8') + tail
      scanned += chunkSize
    }
    return (head.subarray(0, headBytes).toString('utf8') + tail).split('\n')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** True when the accumulated text contains at least one complete JSON line. */
function hasParseableLine(text: string): boolean {
  return text.split('\n').some((line) => parseLine(line) !== null)
}

function parseHeader(line: string | undefined): PiSessionHeader | null {
  const value = parseLine(line)
  if (
    !value || value.type !== 'session' || typeof value.id !== 'string'
    || typeof value.timestamp !== 'string' || typeof value.cwd !== 'string'
  ) return null
  return {
    type: 'session',
    id: value.id,
    timestamp: value.timestamp,
    cwd: value.cwd,
    parentSession: typeof value.parentSession === 'string' ? value.parentSession : undefined,
  }
}

function parseLine(line: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line ?? '')
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

function textContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part): part is Record<string, unknown> =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join(' ')
    .trim()
  return text || undefined
}

function shortenPrompt(prompt: string): string {
  const words = prompt.split(/\s+/)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : prompt
}

/** Uses the Agent tool's short description for generated child-session labels. */
async function addRelatedSessionDisplayNames(
  sessions: RecentSession[],
): Promise<RecentSession[]> {
  const childrenByParent = new Map<string, RecentSession[]>()
  const sessionPaths = new Set(sessions.map((session) => session.sessionPath))
  for (const session of sessions) {
    if (
      !session.parentSessionPath || !sessionPaths.has(session.parentSessionPath)
      || !generatedAgentId(session.name)
    ) continue
    const siblings = childrenByParent.get(session.parentSessionPath) ?? []
    siblings.push(session)
    childrenByParent.set(session.parentSessionPath, siblings)
  }

  const displayNames = new Map<string, string>()
  await Promise.all([...childrenByParent].map(async ([parentPath, children]) => {
    const descriptions = await readAgentDescriptions(parentPath)
    for (const child of children) {
      const agentId = generatedAgentId(child.name)
      const description = agentId ? descriptions.get(agentId) : undefined
      if (description) displayNames.set(child.sessionPath, description)
    }
  }))
  return sessions.map((session) => {
    const displayName = displayNames.get(session.sessionPath)
    return displayName ? { ...session, displayName } : session
  })
}

/** Incrementally indexes Agent result metadata without loading large parent histories into memory. */
async function readAgentDescriptions(parentPath: string): Promise<Map<string, string>> {
  const size = (await stat(parentPath)).size
  let cached = agentDescriptionCache.get(parentPath)
  if (!cached || size < cached.offset) {
    cached = { descriptions: new Map(), offset: 0 }
    agentDescriptionCache.set(parentPath, cached)
  }
  if (size === cached.offset) return cached.descriptions

  let pending = Buffer.alloc(0)
  let consumedOffset = cached.offset
  for await (const chunk of createReadStream(parentPath, { start: cached.offset })) {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    let newlineIndex = pending.indexOf(0x0a)
    while (newlineIndex >= 0) {
      indexAgentDescription(pending.subarray(0, newlineIndex).toString('utf8'), cached.descriptions)
      consumedOffset += newlineIndex + 1
      pending = pending.subarray(newlineIndex + 1)
      newlineIndex = pending.indexOf(0x0a)
    }
  }
  if (pending.length > 0 && indexAgentDescription(pending.toString('utf8'), cached.descriptions)) {
    consumedOffset += pending.length
  }
  cached.offset = consumedOffset
  return cached.descriptions
}

/** Indexes one complete Agent result line and reports whether it was valid JSON. */
function indexAgentDescription(line: string, descriptions: Map<string, string>): boolean {
  const entry = parseLine(line)
  if (!entry) return false
  if (entry.type !== 'message' || !isObject(entry.message)) return true
  const message = entry.message
  if (message.role !== 'toolResult' || message.toolName !== 'Agent' || !isObject(message.details))
    return true
  const { agentId, description } = message.details
  if (typeof agentId === 'string' && typeof description === 'string' && description.trim()) {
    descriptions.set(agentId.slice(0, 8), description.trim())
  }
  return true
}

function generatedAgentId(name: string): string | undefined {
  return name.match(/#([0-9a-f]{8})$/)?.[1]
}

/** Finds persisted parents omitted from the recent-file candidate window. */
function parentPathsToLoad(
  loadedByPath: ReadonlyMap<string, RecentSession>,
  availablePaths: ReadonlySet<string>,
  attemptedPaths: ReadonlySet<string>,
): string[] {
  return [...new Set(
    [...loadedByPath.values()].flatMap((session) => {
      const parentPath = session.parentSessionPath
      return parentPath && availablePaths.has(parentPath) && !loadedByPath.has(parentPath)
          && !attemptedPaths.has(parentPath)
        ? [parentPath]
        : []
    }),
  )]
}

function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}
