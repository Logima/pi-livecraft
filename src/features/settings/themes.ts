/** Editable colour variables exposed in the theme editor. Order matters for the UI. */
export const THEME_VARIABLES = [
  'canvas',
  'surface',
  'ink',
  'accent',
  'secondary',
  'success',
  'warning',
  'danger',
] as const

export type ThemeVariable = (typeof THEME_VARIABLES)[number]

export type ThemeMode = 'light' | 'dark'

export type ThemePalette = Record<ThemeVariable, string>

export type BuiltInThemeId = 'light' | 'dark' | 'gipity' | 'anttropik' | 'neon' | 'acidpop'

export interface ThemePreset {
  id: BuiltInThemeId
  name: string
  mode: ThemeMode
  palette: ThemePalette
  builtIn: true
}

export interface UserTheme {
  id: string
  name: string
  mode: ThemeMode
  palette: ThemePalette
}

export interface BuiltInThemeOverride {
  name: string
  mode: ThemeMode
  palette: ThemePalette
}

/** Any theme the UI can display, preset or user-created. */
export type Theme = ThemePreset | (UserTheme & { builtIn?: never })

export interface ThemePreferences {
  active: string
  themes: UserTheme[]
  builtInOverrides?: Partial<Record<BuiltInThemeId, BuiltInThemeOverride>>
}

// ── Built-in palettes ──────────────────────────────────────────────

const LIGHT_PALETTE: ThemePalette = {
  canvas: '#fafafc',
  surface: '#ffffff',
  ink: '#1d2924',
  accent: '#23776d',
  secondary: '#6851a4',
  success: '#28734b',
  warning: '#b8860b',
  danger: '#a13f37',
}

const DARK_PALETTE: ThemePalette = {
  canvas: '#0a0a0a',
  surface: '#161616',
  ink: '#eeeeee',
  accent: '#fab283',
  secondary: '#9d7cd8',
  success: '#7fd88f',
  warning: '#f5a742',
  danger: '#e06c75',
}

const GIPITY_PALETTE: ThemePalette = {
  canvas: '#ffffff',
  surface: '#f7f7f8',
  ink: '#2d2d2d',
  accent: '#202123',
  secondary: '#6e6e80',
  success: '#10a37f',
  warning: '#b7791f',
  danger: '#c53030',
}

const NEON_PALETTE: ThemePalette = {
  canvas: '#171225',
  surface: '#211a35',
  ink: '#f5efff',
  accent: '#e58ab8',
  secondary: '#5de7ff',
  success: '#72f1a8',
  warning: '#ffd166',
  danger: '#ff6b8b',
}

const ANTTROPIK_PALETTE: ThemePalette = {
  canvas: '#f7f5f0',
  surface: '#fffefa',
  ink: '#3d392f',
  accent: '#d97757',
  secondary: '#b56b4d',
  success: '#5d8064',
  warning: '#bd861f',
  danger: '#bd5148',
}

const ACID_POP_PALETTE: ThemePalette = {
  canvas: '#201027',
  surface: '#2f163b',
  ink: '#fff4dc',
  accent: '#ff4db8',
  secondary: '#99ff33',
  success: '#57f287',
  warning: '#ffd166',
  danger: '#ff6b6b',
}

export const BUILT_IN_THEMES: ThemePreset[] = [
  { id: 'light', name: 'Light', mode: 'light', palette: LIGHT_PALETTE, builtIn: true },
  { id: 'dark', name: 'Dark', mode: 'dark', palette: DARK_PALETTE, builtIn: true },
  { id: 'neon', name: 'Néon', mode: 'dark', palette: NEON_PALETTE, builtIn: true },
  { id: 'gipity', name: 'GiPiTy', mode: 'light', palette: GIPITY_PALETTE, builtIn: true },
  { id: 'anttropik', name: 'AntTropik', mode: 'light', palette: ANTTROPIK_PALETTE, builtIn: true },
  { id: 'acidpop', name: 'Acid Pop', mode: 'dark', palette: ACID_POP_PALETTE, builtIn: true },
]

// ── Persistence keys ───────────────────────────────────────────────

const STORAGE_KEY = 'pi-livecraft.themes'
const LEGACY_THEME_KEY = 'pi-livecraft.theme'
type ThemeStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

type ThemeStyle = {
  setProperty: (name: string, value: string) => void
  removeProperty?: (name: string) => void
}

const DERIVED_THEME_VARIABLES = [
  'surface-raised',
  'sidebar',
  'muted',
  'subtle',
  'line',
  'line-strong',
  'accent-hover',
  'accent-soft',
  'secondary-soft',
  'success-soft',
  'warning-strong',
  'danger-soft',
  'teal',
  'teal-soft',
  'violet',
  'violet-soft',
] as const

/** Returns browser storage without requiring DOM types in the pure test build. */
function themeStorage(): ThemeStorage | undefined {
  return (globalThis as typeof globalThis & { localStorage?: ThemeStorage }).localStorage
}

// ── Validation & migration ─────────────────────────────────────────

function validateHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

/**
 * Normalizes a raw palette object (old 21-token or new 8-token) into a
 * valid ThemePalette. Maps legacy `violet` → `secondary` and drops all
 * derived tokens. Returns null when a source colour is missing or invalid.
 */
function normalizePalette(value: unknown): ThemePalette | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  // Accept the current schema as-is.
  if (THEME_VARIABLES.every((v) => validateHex(obj[v]))) {
    return Object.fromEntries(
      THEME_VARIABLES.map((v) => [v, obj[v] as string]),
    ) as unknown as ThemePalette
  }
  // Migrate from the legacy 21-token schema: map violet → secondary,
  // preserve the 8 source colours, ignore everything else.
  const legacySourceKeys: [string, ThemeVariable][] = [
    ['canvas', 'canvas'],
    ['surface', 'surface'],
    ['ink', 'ink'],
    ['accent', 'accent'],
    ['violet', 'secondary'],
    ['success', 'success'],
    ['warning', 'warning'],
    ['danger', 'danger'],
  ]
  if (legacySourceKeys.every(([legacy]) => validateHex(obj[legacy]))) {
    return Object.fromEntries(
      legacySourceKeys.map(([legacy, current]) => [current, obj[legacy] as string]),
    ) as unknown as ThemePalette
  }
  return null
}

function validateUserTheme(value: unknown): value is UserTheme {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return typeof t.id === 'string' && t.id.length > 0
    && typeof t.name === 'string' && t.name.trim().length > 0
    && (t.mode === 'light' || t.mode === 'dark')
    && normalizePalette(t.palette) !== null
}

function validateThemePreferences(value: unknown): value is ThemePreferences {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return typeof p.active === 'string' && Array.isArray(p.themes)
    && p.themes.every(validateUserTheme)
}

function normalizeBuiltInOverrides(
  value: unknown,
): Partial<Record<BuiltInThemeId, BuiltInThemeOverride>> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const normalized: Partial<Record<BuiltInThemeId, BuiltInThemeOverride>> = {}
  for (const [id, rawOverride] of Object.entries(value)) {
    if (!isBuiltIn(id) || typeof rawOverride !== 'object' || rawOverride === null) continue
    const override = rawOverride as Record<string, unknown>
    const palette = normalizePalette(override.palette)
    if (
      typeof override.name === 'string'
      && override.name.trim()
      && (override.mode === 'light' || override.mode === 'dark')
      && palette
    ) {
      normalized[id as BuiltInThemeId] = {
        name: override.name.trim(),
        mode: override.mode,
        palette,
      }
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/** Normalizes stored source palettes and built-in overrides. */
function normalizePreferences(prefs: ThemePreferences): ThemePreferences {
  const normalized: ThemePreferences = {
    active: prefs.active,
    themes: prefs
      .themes
      .map((t) => {
        const palette = normalizePalette(t.palette)
        return palette ? { ...t, palette } : t
      })
      .filter((t) => normalizePalette(t.palette) !== null),
  }
  const builtInOverrides = normalizeBuiltInOverrides(prefs.builtInOverrides)
  if (builtInOverrides) normalized.builtInOverrides = builtInOverrides
  return normalized
}

// ── Parsing & migration ────────────────────────────────────────────

/**
 * Pure parser: validates raw JSON and migrates a legacy key, returning
 * valid preferences or the light default.
 */
export function parseThemePreferences(raw: unknown, legacyValue: string | null): ThemePreferences {
  if (raw !== null && typeof raw === 'object' && validateThemePreferences(raw)) {
    return normalizePreferences(raw as ThemePreferences)
  }
  const active = legacyValue === 'dark' ? 'dark' : 'light'
  return { active, themes: [] }
}

/** Reads preferences from localStorage, migrating the legacy key on first access. */
export function readThemePreferences(): ThemePreferences {
  try {
    const storage = themeStorage()
    if (!storage) return { active: 'light', themes: [] }
    const raw: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    const legacy = storage.getItem(LEGACY_THEME_KEY)
    if (legacy !== null) storage.removeItem(LEGACY_THEME_KEY)
    return parseThemePreferences(raw, legacy)
  } catch {
    return { active: 'light', themes: [] }
  }
}

/** Persists preferences to localStorage. */
export function persistThemePreferences(prefs: ThemePreferences): void {
  themeStorage()?.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

// ── Domain queries ─────────────────────────────────────────────────

function themeWithOverride(prefs: ThemePreferences, preset: ThemePreset): ThemePreset {
  const override = prefs.builtInOverrides?.[preset.id]
  return override
    ? { ...preset, ...override, palette: { ...override.palette } }
    : preset
}

/** Resolves the active theme, always falling back to Light. */
export function resolveActiveTheme(prefs: ThemePreferences): Theme {
  const builtIn = BUILT_IN_THEMES.find((theme) => theme.id === prefs.active)
  if (builtIn) return themeWithOverride(prefs, builtIn)
  const user = prefs.themes.find((t) => t.id === prefs.active)
  if (user) return user
  return themeWithOverride(prefs, BUILT_IN_THEMES[0])
}

/** Every theme the user can select: presets first, then user themes. */
export function allThemes(prefs: ThemePreferences): Theme[] {
  return [...BUILT_IN_THEMES.map((theme) => themeWithOverride(prefs, theme)), ...prefs.themes]
}

/** Whether an id belongs to a built-in preset. */
export function isBuiltIn(id: string): boolean {
  return BUILT_IN_THEMES.some((theme) => theme.id === id)
}

// ── Mutations (all pure – return new prefs) ────────────────────────

/** Saves the complete current state of an editable built-in theme. */
function updateBuiltInTheme(
  prefs: ThemePreferences,
  id: BuiltInThemeId,
  changes: Partial<Pick<BuiltInThemeOverride, 'name' | 'mode' | 'palette'>>,
): ThemePreferences {
  const preset = BUILT_IN_THEMES.find((theme) => theme.id === id)
  if (!preset) return prefs
  const current = themeWithOverride(prefs, preset)
  const override: BuiltInThemeOverride = {
    name: changes.name ?? current.name,
    mode: changes.mode ?? current.mode,
    palette: { ...current.palette, ...(changes.palette ?? {}) },
  }
  return {
    ...prefs,
    builtInOverrides: { ...prefs.builtInOverrides, [id]: override },
  }
}

/**
 * Creates a user theme from a source palette (defaults to Light preset).
 * The name is deduplicated against existing built-in and user themes.
 */
export function createTheme(
  prefs: ThemePreferences,
  name: string,
  mode: ThemeMode,
  sourcePalette?: ThemePalette,
): ThemePreferences {
  const palette = sourcePalette ? { ...sourcePalette } : { ...LIGHT_PALETTE }
  const allNames = allThemes(prefs).map((t) => t.name)
  const theme: UserTheme = {
    id: crypto.randomUUID(),
    name: uniqueName(name.trim() || 'Custom', allNames),
    mode,
    palette,
  }
  return { ...prefs, themes: [...prefs.themes, theme] }
}

/** Duplicates an existing theme (preset or user) as a new user theme. */
export function duplicateTheme(
  prefs: ThemePreferences,
  sourceId: string,
  newName: string,
): ThemePreferences {
  const source = allThemes(prefs).find((theme) => theme.id === sourceId)
  if (!source) return prefs
  return createTheme(prefs, newName || `${source.name} copy`, source.mode, source.palette)
}

/** Renames a theme, deduplicating the name across built-in and user themes. */
export function renameTheme(prefs: ThemePreferences, id: string, name: string): ThemePreferences {
  const trimmed = name.trim()
  if (!trimmed) return prefs
  const allNames = allThemes(prefs).filter((t) => t.id !== id).map((t) => t.name)
  const nextName = uniqueName(trimmed, allNames)
  if (isBuiltIn(id)) {
    return updateBuiltInTheme(prefs, id as BuiltInThemeId, { name: nextName })
  }
  return {
    ...prefs,
    themes: prefs.themes.map((t) => t.id === id ? { ...t, name: nextName } : t),
  }
}

/** Updates a single palette variable. Hex format is validated. */
export function updateThemeColor(
  prefs: ThemePreferences,
  id: string,
  variable: ThemeVariable,
  color: string,
): ThemePreferences {
  if (!validateHex(color)) return prefs
  if (isBuiltIn(id)) {
    const preset = BUILT_IN_THEMES.find((theme) => theme.id === id)
    if (!preset) return prefs
    const current = themeWithOverride(prefs, preset)
    return updateBuiltInTheme(prefs, preset.id, {
      palette: { ...current.palette, [variable]: color },
    })
  }
  return {
    ...prefs,
    themes: prefs.themes.map((t) =>
      t.id === id ? { ...t, palette: { ...t.palette, [variable]: color } } : t
    ),
  }
}

/** Updates the mode (light/dark) of a theme. */
export function updateThemeMode(
  prefs: ThemePreferences,
  id: string,
  mode: ThemeMode,
): ThemePreferences {
  if (isBuiltIn(id)) return updateBuiltInTheme(prefs, id as BuiltInThemeId, { mode })
  return {
    ...prefs,
    themes: prefs.themes.map((t) => t.id === id ? { ...t, mode } : t),
  }
}

/** Deletes a user theme. Falls back to Light if the active theme is deleted. */
export function deleteTheme(prefs: ThemePreferences, id: string): ThemePreferences {
  if (isBuiltIn(id)) return prefs
  return {
    ...prefs,
    active: prefs.active === id ? 'light' : prefs.active,
    themes: prefs.themes.filter((t) => t.id !== id),
  }
}

/** Restores a built-in theme to its shipped palette, name, and mode. */
export function resetTheme(prefs: ThemePreferences, id: string): ThemePreferences {
  if (!isBuiltIn(id) || !prefs.builtInOverrides?.[id as BuiltInThemeId]) return prefs
  const builtInId = id as BuiltInThemeId
  const { [builtInId]: _removed, ...remaining } = prefs.builtInOverrides
  if (Object.keys(remaining).length === 0) {
    const { builtInOverrides: _overrides, ...withoutOverrides } = prefs
    return withoutOverrides
  }
  return { ...prefs, builtInOverrides: remaining }
}

/** Sets the active theme. Unknown ids are silently ignored. */
export function setActiveTheme(prefs: ThemePreferences, id: string): ThemePreferences {
  if (isBuiltIn(id) || prefs.themes.some((t) => t.id === id)) {
    return { ...prefs, active: id }
  }
  return prefs
}

// ── Runtime application ────────────────────────────────────────────

/**
 * Returns either '#ffffff' or '#000000' depending on whether the given
 * hex colour is dark enough to need light text. Uses W3C relative luminance.
 */
export function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

/** Applies source colours and removes stale derived inline variables from a DOM element. */
export function applyThemePalette(element: { style: ThemeStyle }, palette: ThemePalette): void {
  for (const variable of DERIVED_THEME_VARIABLES) {
    element.style.removeProperty?.(`--${variable}`)
  }
  for (const variable of THEME_VARIABLES) {
    element.style.setProperty(`--${variable}`, palette[variable])
  }
  element.style.setProperty('--on-accent', contrastColor(palette.accent))
  element.style.setProperty('--on-danger', contrastColor(palette.danger))
}

/** Shadow values derived from the theme mode. */
export function shadowForMode(mode: ThemeMode): Record<'shadow' | 'shadow-soft', string> {
  return mode === 'dark'
    ? {
      shadow: '0 8px 24px rgb(0 0 0 / 24%)',
      'shadow-soft': '0 3px 10px rgb(0 0 0 / 18%)',
    }
    : {
      shadow: '0 12px 30px rgb(0 0 0 / 7%)',
      'shadow-soft': '0 4px 14px rgb(0 0 0 / 5%)',
    }
}

// ── Helpers ────────────────────────────────────────────────────────

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base} ${i}`)) i++
  return `${base} ${i}`
}
