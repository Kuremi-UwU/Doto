import { app, nativeImage, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import JSZip from 'jszip'
import { extname, join } from 'node:path'
import { DEFAULT_DOCK, normalizeDock } from '../shared/dock'
import { DEFAULT_KEYBINDS, normalizeKeybinds } from '../shared/keys'
import { ARCHIVE_DAYS, MODULE_COLORS } from '../shared/types'
import { moduleHasInformation, openTasksIn, tabHasInformation, wordsIn } from '../shared/stats'
import { noteToDocx } from './document'
import { appIconPath } from './icon'
import type {
  ArchivedNote,
  InkStroke,
  InkTool,
  Library,
  ModuleColor,
  ModuleInstance,
  ModuleRect,
  NoteContent,
  Opened,
  SaveBackup,
  SaveSummary,
  Tab,
  TabSummary,
  TextFrame,
  Theme,
  TodoItem
} from '../shared/types'

export const ASSET_SCHEME = 'doto-asset'
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'm4v']

const FORMAT_VERSION = 2
const UNTITLED = 'Untitled'
const MAX_TITLE_LENGTH = 120
const MAX_TODO_LENGTH = 2000
const MAX_NOTE_TEXT = 20000
const ARCHIVE_MS = ARCHIVE_DAYS * 24 * 60 * 60 * 1000
const ID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`)
const ASSET_NAME_PATTERN = new RegExp(`^${ID_SOURCE}\\.(${[...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join('|')})$`)
const DEFAULT_RECT: ModuleRect = { x: 24, y: 24, width: 340, height: 420 }

const dataDir = (): string => app.getPath('userData')
const libraryFile = (): string => join(dataDir(), 'library.json')
const pagesDir = (): string => join(dataDir(), 'pages')
const pageFile = (id: string): string => join(pagesDir(), `${id}.json`)
const assetsDir = (): string => join(dataDir(), 'assets')

let library: Library | null = null
let shortcutCapture = false
let queue: Promise<unknown> = Promise.resolve()

/** Every read-modify-write goes through one queue so saves land on disk in the order they were sent. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => undefined)
  return run
}

export function whenIdle(): Promise<void> {
  return queue.then(() => undefined)
}

export function currentKeybinds(): Library['keybinds'] {
  return library?.keybinds ?? DEFAULT_KEYBINDS
}

export function setShortcutCapture(on: boolean): void {
  shortcutCapture = on
}

export function isShortcutCapture(): boolean {
  return shortcutCapture
}

export function isPageId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function loadLibrary(): Promise<Library> {
  return serialized(async () => structuredClone(await ensureLibrary()))
}

export function setExportDir(dir: string | null): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = activeSave(lib)
    save.exportDir = dir
    save.exportFiles = {}
    if (dir) {
      for (const summary of save.tabs) {
        const tab = await readTabFile(summary.id, summary.title)
        await writeExport(save, tab)
      }
    }
    save.updatedAt = Date.now()
    await writeLibrary(lib)
    return structuredClone(lib)
  })
}

export function setAutoSave(enabled: boolean, minutes: unknown): Promise<void> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    lib.autoSave = enabled
    lib.autoSaveMinutes = clampMinutes(minutes)
    await writeLibrary(lib)
  })
}

export function listBackups(): Promise<SaveBackup[]> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = activeSave(lib)
    const listed: SaveBackup[] = []
    for (const slot of [1, 2] as const) {
      const file = await readJson(backupFile(save.id, slot))
      if (!isRecord(file)) continue
      listed.push({ slot, savedAt: finiteOr(file.savedAt, 0), title: cleanTitle(file.title) })
    }
    return listed
  })
}

export function restoreBackup(slot: 1 | 2): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = activeSave(lib)
    const stored = await readJson(backupFile(save.id, slot))
    const tabs = isRecord(stored) && Array.isArray(stored.tabs) ? stored.tabs.filter(isRecord).map((item) => normalizeTab(item, isPageId(item.id) ? item.id : randomUUID())) : []
    if (tabs.length === 0) return opened(lib, await readTabFile(save.activeTabId, tabTitle(save, save.activeTabId)))

    const keep = new Set(tabs.map((tab) => tab.id))
    for (const existing of save.tabs) {
      if (!keep.has(existing.id)) await fs.rm(pageFile(existing.id), { force: true })
    }
    for (const tab of tabs) await writeJson(pageFile(tab.id), { version: FORMAT_VERSION, ...tab })
    save.tabs = tabs.map((tab) => ({ id: tab.id, title: tab.title, openTasks: openTasksIn(tab.modules), words: wordsIn(tab.content), color: tab.color }))
    save.title = cleanTitle(isRecord(stored) ? stored.title : save.title)
    if (!save.tabs.some((tab) => tab.id === save.activeTabId)) save.activeTabId = save.tabs[0].id
    save.updatedAt = Date.now()
    await writeLibrary(lib)
    return opened(lib, await readTabFile(save.activeTabId, tabTitle(save, save.activeTabId)))
  })
}

export function setTheme(theme: Theme): Promise<void> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    if (lib.theme === theme) return
    lib.theme = theme
    await writeLibrary(lib)
  })
}

export function createSave(): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = emptySave()
    const tab = await addTab(save)
    lib.saves.push(save)
    lib.activeSaveId = save.id
    await writeLibrary(lib)
    return opened(lib, tab)
  })
}

export function renameSave(id: string, title: unknown): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = lib.saves.find((entry) => entry.id === id)
    if (!save) return structuredClone(lib)
    const clean = cleanTitle(title)
    if (save.title !== clean) {
      save.title = clean
      save.updatedAt = Date.now()
      await writeLibrary(lib)
    }
    return structuredClone(lib)
  })
}

export function openSave(id: string): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = lib.saves.find((entry) => entry.id === id)
    if (!save) throw new Error(`Unknown save ${id}`)
    lib.activeSaveId = save.id
    save.updatedAt = Date.now()
    await writeLibrary(lib)
    return opened(lib, await readTabFile(save.activeTabId, tabTitle(save, save.activeTabId)))
  })
}

export function createTab(): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = activeSave(lib)
    const tab = await addTab(save)
    await writeLibrary(lib)
    return opened(lib, tab)
  })
}

export function reorderTabs(ids: unknown): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = activeSave(lib)
    if (!Array.isArray(ids) || ids.length !== save.tabs.length) return structuredClone(lib)
    if (!ids.every((id) => typeof id === 'string' && save.tabs.some((tab) => tab.id === id))) return structuredClone(lib)
    if (new Set(ids).size !== ids.length) return structuredClone(lib)
    save.tabs = (ids as string[]).map((id) => save.tabs.find((tab) => tab.id === id) as TabSummary)
    save.updatedAt = Date.now()
    await writeLibrary(lib)
    return structuredClone(lib)
  })
}

export function openTab(id: string): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = saveContaining(lib, id)
    if (!save) throw new Error(`Unknown tab ${id}`)
    lib.activeSaveId = save.id
    save.activeTabId = id
    save.updatedAt = Date.now()
    await writeLibrary(lib)
    return opened(lib, await readTabFile(id, tabTitle(save, id)))
  })
}

export function readTab(id: string): Promise<Tab> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const save = saveContaining(lib, id)
    if (!save) throw new Error(`Unknown tab ${id}`)
    return readTabFile(id, tabTitle(save, id))
  })
}

export function saveTab(input: unknown): Promise<TabSummary | null> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const id = isRecord(input) ? input.id : undefined
    const save = typeof id === 'string' ? saveContaining(lib, id) : undefined
    const summary = save?.tabs.find((tab) => tab.id === id)
    if (!save || !summary) return null

    await rotateBackup(save).catch(() => undefined)
    const tab = normalizeTab(input, summary.id, summary.title)
    tab.updatedAt = Date.now()
    await writeJson(pageFile(tab.id), { version: FORMAT_VERSION, ...tab })
    await writeExport(save, tab).catch((error: unknown) => console.error('Could not write the Word document', error))
    summary.title = tab.title
    summary.openTasks = openTasksIn(tab.modules)
    summary.words = wordsIn(tab.content)
    summary.color = tab.color
    save.updatedAt = tab.updatedAt
    await writeLibrary(lib)
    return { ...summary }
  })
}

export function deleteSave(id: string): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const index = lib.saves.findIndex((save) => save.id === id)
    if (index === -1) {
      const save = activeSave(lib)
      return opened(lib, await readTabFile(save.activeTabId, tabTitle(save, save.activeTabId)))
    }

    const save = lib.saves[index]
    const wasActive = lib.activeSaveId === save.id
    for (const summary of [...save.tabs].reverse()) {
      const tab = await readTabFile(summary.id, summary.title)
      await retireTab(lib, save, tab)
    }
    lib.saves.splice(index, 1)
    if (lib.saves.length === 0) {
      const fresh = emptySave()
      await addTab(fresh)
      lib.saves.push(fresh)
    }
    if (wasActive || !lib.saves.some((entry) => entry.id === lib.activeSaveId)) {
      lib.activeSaveId = lib.saves[Math.min(index, lib.saves.length - 1)].id
    }
    await writeLibrary(lib)
    const current = activeSave(lib)
    return opened(lib, await readTabFile(current.activeTabId, tabTitle(current, current.activeTabId)))
  })
}

export function archiveTab(id: string): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const located = locateTab(lib, id)
    if (!located) return opened(lib, await readTabFile(activeSave(lib).activeTabId, tabTitle(activeSave(lib), activeSave(lib).activeTabId)))

    const { save, index } = located
    const summary = save.tabs[index]
    const tab = await readTabFile(id, summary.title)
    await retireTab(lib, save, tab)
    save.tabs.splice(index, 1)
    if (save.tabs.length === 0) await addTab(save)
    else if (save.activeTabId === id) save.activeTabId = save.tabs[Math.min(index, save.tabs.length - 1)].id
    save.updatedAt = Date.now()
    await writeLibrary(lib)
    const current = activeSave(lib)
    return opened(lib, await readTabFile(current.activeTabId, tabTitle(current, current.activeTabId)))
  })
}

/** A note with writing, media, or a filled window goes to the trash. A blank one is removed. */
async function retireTab(lib: Library, save: SaveSummary, tab: Tab): Promise<void> {
  if (tabHasInformation(tab)) {
    lib.archive.unshift({
      id: tab.id,
      saveId: save.id,
      saveTitle: save.title,
      title: tab.title,
      content: tab.content,
      modules: tab.modules,
      color: tab.color,
      ink: tab.ink,
      kind: 'tab',
      createdAt: tab.createdAt,
      archivedAt: Date.now()
    })
  }
  await removeExport(save, tab.id)
  await fs.rm(pageFile(tab.id), { force: true })
  if (!tabHasInformation(tab)) await fs.rm(join(assetsDir(), tab.id), { recursive: true, force: true })
}

export function trashModule(input: unknown): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const data = isRecord(input) ? input : {}
    const kind = data.kind === 'todo' ? 'todo' : data.kind === 'notes' ? 'notes' : null
    const snapshot = kind ? normalizeModule({ ...data, kind, pinned: false }) : null
    if (!snapshot || !moduleHasInformation(snapshot)) return structuredClone(lib)
    const save = activeSave(lib)
    lib.archive.unshift({
      id: randomUUID(),
      saveId: save.id,
      saveTitle: save.title,
      title: snapshot.title,
      content: snapshot.content,
      modules: [{ ...snapshot, id: randomUUID() }],
      color: 'default',
      ink: [],
      kind: snapshot.kind,
      createdAt: Date.now(),
      archivedAt: Date.now()
    })
    await writeLibrary(lib)
    return structuredClone(lib)
  })
}

export function restoreArchived(id: string): Promise<Opened> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const index = lib.archive.findIndex((entry) => entry.id === id)
    if (index === -1) {
      const save = activeSave(lib)
      return opened(lib, await readTabFile(save.activeTabId, tabTitle(save, save.activeTabId)))
    }

    const entry = lib.archive[index]
    if (entry.kind === 'notes' || entry.kind === 'todo') {
      const save = activeSave(lib)
      const tab = await readTabFile(save.activeTabId, tabTitle(save, save.activeTabId))
      const snapshot = entry.modules[0]
      if (snapshot) {
        tab.modules = [...tab.modules, { ...snapshot, id: randomUUID(), kind: entry.kind }]
        tab.updatedAt = Date.now()
        await writeJson(pageFile(tab.id), { version: FORMAT_VERSION, ...tab })
      }
      lib.archive.splice(index, 1)
      await writeLibrary(lib)
      return opened(lib, tab)
    }
    const save = lib.saves.find((item) => item.id === entry.saveId) ?? activeSave(lib)
    // A tab created after this note was archived may have reused nothing, but never the same id while it is archived.
    if (!save.tabs.some((tab) => tab.id === entry.id)) {
      const tab = normalizeTab(entry, entry.id, entry.title)
      await writeJson(pageFile(tab.id), { version: FORMAT_VERSION, ...tab })
      save.tabs.push(measured(tab))
    }
    save.activeTabId = entry.id
    save.updatedAt = Date.now()
    lib.activeSaveId = save.id
    lib.archive.splice(index, 1)
    await writeLibrary(lib)
    return opened(lib, await readTabFile(entry.id, tabTitle(save, entry.id)))
  })
}

export function emptyTrash(): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    for (const entry of lib.archive) {
      if (!saveContaining(lib, entry.id)) await fs.rm(join(assetsDir(), entry.id), { recursive: true, force: true })
    }
    lib.archive = []
    await writeLibrary(lib)
    return structuredClone(lib)
  })
}

export function setStatusBar(input: unknown): Promise<void> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    lib.statusBar = normalizeStatusBar(input)
    await writeLibrary(lib)
  })
}

export function setDock(input: unknown): Promise<void> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    lib.dock = normalizeDock(input)
    await writeLibrary(lib)
  })
}

export function setKeybinds(input: unknown): Promise<void> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    lib.keybinds = normalizeKeybinds(input)
    await writeLibrary(lib)
  })
}

export function setTabColor(id: string, color: ModuleColor): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const located = locateTab(lib, id)
    if (!located) return structuredClone(lib)
    const tab = await readTabFile(id, located.save.tabs[located.index].title)
    tab.color = isColor(color) ? color : 'default'
    tab.updatedAt = Date.now()
    await writeJson(pageFile(tab.id), { version: FORMAT_VERSION, ...tab })
    located.save.tabs[located.index].color = tab.color
    located.save.updatedAt = tab.updatedAt
    await writeLibrary(lib)
    return structuredClone(lib)
  })
}

export function deleteArchived(id: string): Promise<Library> {
  return serialized(async () => {
    const lib = await ensureLibrary()
    const index = lib.archive.findIndex((entry) => entry.id === id)
    if (index === -1) return structuredClone(lib)
    lib.archive.splice(index, 1)
    if (!saveContaining(lib, id)) await fs.rm(join(assetsDir(), id), { recursive: true, force: true })
    await writeLibrary(lib)
    return structuredClone(lib)
  })
}

export function importVideos(tabId: string, sources: string[]): Promise<string[]> {
  return importAssets(tabId, sources, VIDEO_EXTENSIONS)
}

export async function importImages(tabId: string, sources: string[]): Promise<string[]> {
  return importAssets(tabId, sources, IMAGE_EXTENSIONS)
}

async function importAssets(tabId: string, sources: string[], allowed: string[]): Promise<string[]> {
  const lib = await serialized(ensureLibrary)
  if (!saveContaining(lib, tabId)) return []

  const dir = join(assetsDir(), tabId)
  await fs.mkdir(dir, { recursive: true })
  const urls: string[] = []
  for (const source of sources) {
    const extension = extname(source).slice(1).toLowerCase()
    if (!allowed.includes(extension)) continue
    const name = `${randomUUID()}.${extension}`
    await fs.copyFile(source, join(dir, name))
    urls.push(`${ASSET_SCHEME}://${tabId}/${name}`)
  }
  return urls
}

/** Maps `doto-asset://<tabId>/<file>` to a path inside the assets folder, or `null` if the URL is not one of ours. */
export function resolveAssetPath(url: string): string | null {
  const { host, pathname } = new URL(url)
  const name = decodeURIComponent(pathname.slice(1))
  if (!isPageId(host) || !ASSET_NAME_PATTERN.test(name)) return null
  return join(assetsDir(), host, name)
}

async function ensureLibrary(): Promise<Library> {
  if (library) return library

  await fs.mkdir(pagesDir(), { recursive: true })
  const stored = await readJson(libraryFile())
  const saved = isRecord(stored) ? stored : {}
  const onDisk = (await fs.readdir(pagesDir()))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .filter(isPageId)

  const lib = Array.isArray(saved.saves) ? await libraryFromSaves(saved, onDisk) : await libraryFromPages(saved, onDisk)
  lib.theme = saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  lib.autoSave = saved.autoSave === true
  lib.autoSaveMinutes = clampMinutes(saved.autoSaveMinutes)
  lib.statusBar = normalizeStatusBar(saved.statusBar)
  lib.dock = normalizeDock(saved.dock)
  lib.keybinds = normalizeKeybinds(saved.keybinds)
  await purgeArchive(lib)
  if (lib.saves.length === 0) {
    const save = emptySave()
    await addTab(save)
    lib.saves.push(save)
  }
  if (!lib.saves.some((save) => save.id === lib.activeSaveId)) lib.activeSaveId = lib.saves[0].id
  for (const save of lib.saves) {
    if (save.tabs.length === 0) await addTab(save)
    else if (!save.tabs.some((tab) => tab.id === save.activeTabId)) save.activeTabId = save.tabs[0].id
  }
  await writeLibrary(lib)
  library = lib
  return lib
}

/** Current format: saves own their tabs, and page files on disk are the source of truth for which tabs exist. */
async function libraryFromSaves(saved: Record<string, unknown>, onDisk: string[]): Promise<Library> {
  const saves: SaveSummary[] = []
  for (const entry of saved.saves as unknown[]) {
    if (!isRecord(entry) || !isPageId(entry.id)) continue
    if (saves.some((save) => save.id === entry.id)) continue
    const tabs: TabSummary[] = []
    for (const tab of Array.isArray(entry.tabs) ? entry.tabs : []) {
      if (!isRecord(tab) || !isPageId(tab.id) || !onDisk.includes(tab.id)) continue
      if (tabs.some((item) => item.id === tab.id) || saves.some((save) => save.tabs.some((item) => item.id === tab.id))) continue
      tabs.push(await measuredFromFile(tab.id as string, cleanTitle(tab.title)))
    }
    saves.push({
      id: entry.id,
      title: cleanTitle(entry.title),
      tabs,
      activeTabId: typeof entry.activeTabId === 'string' ? entry.activeTabId : '',
      updatedAt: finiteOr(entry.updatedAt, Date.now()),
      exportDir: typeof entry.exportDir === 'string' && entry.exportDir.trim() ? entry.exportDir : null,
      exportFiles: normalizeExportFiles(entry.exportFiles)
    })
  }

  const known = new Set(saves.flatMap((save) => save.tabs.map((tab) => tab.id)))
  const orphans: TabSummary[] = []
  for (const id of onDisk) {
    if (known.has(id)) continue
    const file = await readJson(pageFile(id))
    orphans.push(measured(normalizeTab(file, id)))
  }
  if (orphans.length > 0) {
    const home = saves[0] ?? emptySave()
    if (!saves.includes(home)) saves.push(home)
    home.tabs.push(...orphans)
  }

  return {
    saves,
    activeSaveId: typeof saved.activeSaveId === 'string' ? saved.activeSaveId : '',
    theme: 'light',
    archive: normalizeArchive(saved.archive),
    autoSave: false,
    autoSaveMinutes: 5,
    statusBar: { currentTab: true, saveTasks: true, words: true },
    dock: DEFAULT_DOCK,
    keybinds: DEFAULT_KEYBINDS
  }
}

/** Older builds stored a flat page list. Those pages become tabs of one save. */
async function libraryFromPages(saved: Record<string, unknown>, onDisk: string[]): Promise<Library> {
  const tabs: TabSummary[] = []
  for (const entry of Array.isArray(saved.pages) ? saved.pages : []) {
    if (!isRecord(entry) || !isPageId(entry.id) || !onDisk.includes(entry.id)) continue
    if (tabs.some((tab) => tab.id === entry.id)) continue
    tabs.push(await measuredFromFile(entry.id, cleanTitle(entry.title)))
  }
  for (const id of onDisk) {
    if (tabs.some((tab) => tab.id === id)) continue
    const file = await readJson(pageFile(id))
    tabs.push(measured(normalizeTab(file, id)))
  }

  const save = emptySave()
  save.tabs = tabs
  save.activeTabId = typeof saved.activePageId === 'string' ? saved.activePageId : tabs[0]?.id ?? ''
  return { saves: tabs.length > 0 ? [save] : [], activeSaveId: save.id, theme: 'light', archive: [], autoSave: false, autoSaveMinutes: 5, statusBar: { currentTab: true, saveTasks: true, words: true }, dock: DEFAULT_DOCK, keybinds: DEFAULT_KEYBINDS }
}

async function purgeArchive(lib: Library): Promise<void> {
  const now = Date.now()
  const live = new Set(lib.saves.flatMap((save) => save.tabs.map((tab) => tab.id)))
  const kept: ArchivedNote[] = []
  for (const entry of lib.archive) {
    if (live.has(entry.id)) continue
    if (now - entry.archivedAt >= ARCHIVE_MS) {
      await fs.rm(join(assetsDir(), entry.id), { recursive: true, force: true })
      continue
    }
    kept.push(entry)
  }
  lib.archive = kept
}

function emptySave(): SaveSummary {
  return { id: randomUUID(), title: UNTITLED, tabs: [], activeTabId: '', updatedAt: Date.now(), exportDir: null, exportFiles: {} }
}

async function addTab(save: SaveSummary): Promise<Tab> {
  const now = Date.now()
  const tab: Tab = { id: randomUUID(), title: UNTITLED, content: null, textFrame: null, modules: [], color: 'default', ink: [], createdAt: now, updatedAt: now }
  await writeJson(pageFile(tab.id), { version: FORMAT_VERSION, ...tab })
  save.tabs.push({ id: tab.id, title: tab.title, openTasks: 0, words: 0, color: 'default' })
  save.activeTabId = tab.id
  save.updatedAt = now
  return tab
}

function activeSave(lib: Library): SaveSummary {
  return lib.saves.find((save) => save.id === lib.activeSaveId) ?? lib.saves[0]
}

function saveContaining(lib: Library, tabId: string): SaveSummary | undefined {
  return lib.saves.find((save) => save.tabs.some((tab) => tab.id === tabId))
}

function locateTab(lib: Library, tabId: string): { save: SaveSummary; index: number } | undefined {
  for (const save of lib.saves) {
    const index = save.tabs.findIndex((tab) => tab.id === tabId)
    if (index !== -1) return { save, index }
  }
  return undefined
}

function tabTitle(save: SaveSummary, id: string): string {
  return save.tabs.find((tab) => tab.id === id)?.title ?? UNTITLED
}

async function readTabFile(id: string, fallbackTitle: string): Promise<Tab> {
  return normalizeTab(await readJson(pageFile(id)), id, fallbackTitle)
}

function opened(lib: Library, tab: Tab): Opened {
  return { library: structuredClone(lib), tab }
}

function writeLibrary(lib: Library): Promise<void> {
  return writeJson(libraryFile(), {
    version: FORMAT_VERSION,
    saves: lib.saves,
    activeSaveId: lib.activeSaveId,
    theme: lib.theme,
    archive: lib.archive,
    autoSave: lib.autoSave,
    autoSaveMinutes: lib.autoSaveMinutes,
    statusBar: lib.statusBar,
    dock: lib.dock,
    keybinds: lib.keybinds
  })
}

function measured(tab: Tab): TabSummary {
  return { id: tab.id, title: tab.title, openTasks: openTasksIn(tab.modules), words: wordsIn(tab.content), color: tab.color }
}

async function measuredFromFile(id: string, title: string): Promise<TabSummary> {
  return measured(normalizeTab(await readJson(pageFile(id)), id, title))
}

function normalizeStatusBar(value: unknown): Library['statusBar'] {
  const data = isRecord(value) ? value : {}
  return {
    currentTab: data.currentTab !== false,
    saveTasks: data.saveTasks !== false,
    words: data.words !== false
  }
}

async function writeExport(save: SaveSummary, tab: Tab): Promise<void> {
  if (!save.exportDir) return
  const used = new Set(
    Object.entries(save.exportFiles)
      .filter(([id]) => id !== tab.id)
      .map(([, name]) => name.toLowerCase())
  )
  const name = safeDocName(tab.title, tab.id, used)
  const previous = save.exportFiles[tab.id]
  if (previous && previous.toLowerCase() !== name.toLowerCase()) await fs.rm(join(save.exportDir, previous), { force: true })
  const buffer = await stampExport(await noteToDocx(tab, readDocImage))
  await fs.mkdir(save.exportDir, { recursive: true })
  await fs.writeFile(join(save.exportDir, name), buffer)
  save.exportFiles[tab.id] = name
}

/** Puts the Doto mark on the Word file so Explorer can show it as the file thumbnail. */
async function stampExport(docx: Buffer): Promise<Buffer> {
  const image = nativeImage.createFromPath(appIconPath())
  if (image.isEmpty()) return docx
  const jpeg = image.resize({ width: 256, height: 256 }).toJPEG(90)
  const zip = await JSZip.loadAsync(docx)
  zip.file('docProps/thumbnail.jpeg', jpeg)
  const types = await zip.file('[Content_Types].xml')?.async('string')
  if (types && !types.includes('/docProps/thumbnail.jpeg')) {
    zip.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/></Types>'))
  }
  const rels = await zip.file('_rels/.rels')?.async('string')
  if (rels && !rels.includes('metadata/thumbnail')) {
    zip.file('_rels/.rels', rels.replace('</Relationships>', '<Relationship Id="rIdThumb" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>'))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function removeExport(save: SaveSummary, tabId: string): Promise<void> {
  const name = save.exportFiles[tabId]
  if (save.exportDir && name) await fs.rm(join(save.exportDir, name), { force: true }).catch(() => undefined)
  delete save.exportFiles[tabId]
}

async function readDocImage(src: string): Promise<Buffer | null> {
  if (!src.startsWith(`${ASSET_SCHEME}://`)) return null
  const file = resolveAssetPath(src)
  return file ? fs.readFile(file).catch(() => null) : null
}

function safeDocName(title: string, id: string, used: Set<string>): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'Untitled'
  let name = `${clean}.docx`
  if (used.has(name.toLowerCase())) name = `${clean} (${id.slice(0, 8)}).docx`
  used.add(name.toLowerCase())
  return name
}

function normalizeExportFiles(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const files: Record<string, string> = {}
  for (const [id, name] of Object.entries(value)) {
    if (isPageId(id) && typeof name === 'string' && /^[^\\/:*?"<>|]+\.docx$/i.test(name)) files[id] = name
  }
  return files
}

function backupFile(saveId: string, slot: 1 | 2): string {
  return join(dataDir(), 'backups', saveId, `${slot}.json`)
}

/** Keeps the two most recent on-disk copies of a save. The newest is slot 1. */
async function rotateBackup(save: SaveSummary): Promise<void> {
  const newer = backupFile(save.id, 1)
  const older = backupFile(save.id, 2)
  await fs.mkdir(join(dataDir(), 'backups', save.id), { recursive: true })
  await fs.rm(older, { force: true })
  await fs.rename(newer, older).catch(() => undefined)
  const tabs: Tab[] = []
  for (const summary of save.tabs) tabs.push(await readTabFile(summary.id, summary.title))
  await writeJson(newer, { savedAt: Date.now(), title: save.title, tabs })
}

function clampMinutes(value: unknown): number {
  const minutes = Math.round(finiteOr(value, 5))
  return Math.min(180, Math.max(1, minutes))
}

function normalizeArchive(input: unknown): ArchivedNote[] {
  if (!Array.isArray(input)) return []
  const notes: ArchivedNote[] = []
  for (const entry of input) {
    if (!isRecord(entry) || !isPageId(entry.id)) continue
    if (notes.some((note) => note.id === entry.id)) continue
    const tab = normalizeTab(entry, entry.id)
    notes.push({
      id: tab.id,
      saveId: isPageId(entry.saveId) ? entry.saveId : '',
      saveTitle: cleanTitle(entry.saveTitle),
      title: tab.title,
      content: tab.content,
      modules: tab.modules,
      color: tab.color,
      ink: tab.ink,
      createdAt: tab.createdAt,
      archivedAt: finiteOr(entry.archivedAt, Date.now()),
      kind: entry.kind === 'notes' || entry.kind === 'todo' ? entry.kind : 'tab'
    })
  }
  return notes
}

function normalizeTab(input: unknown, id: string, fallbackTitle = UNTITLED): Tab {
  const data = isRecord(input) ? input : {}
  const now = Date.now()
  const modules = Array.isArray(data.modules)
    ? data.modules.filter(isRecord).flatMap((item) => {
        const module = normalizeModule(item)
        return module ? [module] : []
      })
    : legacyModules(data)
  return {
    id,
    title: cleanTitle(data.title ?? fallbackTitle),
    content: isRecord(data.content) ? data.content : null,
    textFrame: normalizeFrame(data.textFrame),
    modules,
    color: isColor(data.color) ? data.color : 'default',
    ink: normalizeInk(data.ink),
    createdAt: finiteOr(data.createdAt, now),
    updatedAt: finiteOr(data.updatedAt, now)
  }
}

function normalizeInk(value: unknown): InkStroke[] {
  if (!Array.isArray(value)) return []
  const strokes: InkStroke[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.surface !== 'string') continue
    const tool: InkTool | null = entry.tool === 'pen' || entry.tool === 'highlighter' || entry.tool === 'eraser' ? entry.tool : null
    if (!tool || !Array.isArray(entry.points)) continue
    const points = entry.points.filter(isRecord).flatMap((point) => {
      const x = point.x
      const y = point.y
      return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : []
    })
    if (points.length === 0) continue
    const size = typeof entry.size === 'number' && Number.isFinite(entry.size) ? Math.min(48, Math.max(1, entry.size)) : 4
    const color = typeof entry.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.color) ? entry.color : '#1c1b19'
    const basis = typeof entry.basis === 'number' && Number.isFinite(entry.basis) && entry.basis > 0 ? entry.basis : undefined
    strokes.push({ id: entry.id.slice(0, 80), surface: entry.surface.slice(0, 80), tool, color, size, ...(basis ? { basis } : {}), points: points.slice(0, 4000) })
    if (strokes.length >= 500) break
  }
  return strokes
}

/** A page written before modules existed kept one to-do list beside the note. */
function legacyModules(data: Record<string, unknown>): ModuleInstance[] {
  const todos = Array.isArray(data.todos) ? data.todos.filter(isRecord).map(normalizeTodo) : []
  const window = isRecord(data.todoWindow) ? data.todoWindow : null
  if (window?.open !== true && todos.length === 0) return []
    return [
    {
      id: randomUUID(),
      kind: 'todo',
      title: 'To-do',
      color: 'default',
      pinned: false,
      rect: normalizeRect(window) ?? DEFAULT_RECT,
      todos,
      content: null
    }
  ]
}

function normalizeModule(input: Record<string, unknown>): ModuleInstance | null {
  if (input.kind !== 'todo' && input.kind !== 'notes') return null
  const kind = input.kind
  return {
    id: isPageId(input.id) ? input.id : randomUUID(),
    kind,
    title: moduleTitle(kind, input.title),
    color: isColor(input.color) ? input.color : 'default',
    pinned: input.pinned === true,
    rect: normalizeRect(input.rect) ?? DEFAULT_RECT,
    todos: kind === 'todo' && Array.isArray(input.todos) ? input.todos.filter(isRecord).map(normalizeTodo) : [],
    content: moduleContent(kind, input)
  }
}

function moduleTitle(kind: ModuleInstance['kind'], value: unknown): string {
  const title = typeof value === 'string' ? value.trim().slice(0, MAX_TITLE_LENGTH) : ''
  return title || (kind === 'todo' ? 'To-do' : 'Notes')
}

/** Notes used to be plain text. A to-do window can also hold images and video in `content`. */
function moduleContent(kind: ModuleInstance['kind'], input: Record<string, unknown>): NoteContent | null {
  if (isRecord(input.content) && input.content.type === 'doc') return input.content
  if (kind !== 'notes' || typeof input.text !== 'string' || !input.text) return null
  return {
    type: 'doc',
    content: input.text.split('\n').map((line) =>
      line ? { type: 'paragraph', content: [{ type: 'text', text: line.slice(0, MAX_NOTE_TEXT) }] } : { type: 'paragraph' }
    )
  }
}

function normalizeTodo(todo: Record<string, unknown>): TodoItem {
  return {
    id: typeof todo.id === 'string' && todo.id ? todo.id : randomUUID(),
    text: String(todo.text ?? '').slice(0, MAX_TODO_LENGTH),
    done: todo.done === true
  }
}

function normalizeFrame(input: unknown): TextFrame | null {
  if (!isRecord(input)) return null
  const { x, width } = input
  if (typeof x !== 'number' || typeof width !== 'number' || !Number.isFinite(x) || !Number.isFinite(width)) return null
  if (width < 160) return null
  return { x, width }
}

function normalizeRect(input: unknown): ModuleRect | null {
  if (!isRecord(input)) return null
  const { x, y, width, height } = input
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

function isColor(value: unknown): value is ModuleColor {
  return typeof value === 'string' && (MODULE_COLORS as readonly string[]).includes(value)
}

function cleanTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim().slice(0, MAX_TITLE_LENGTH) : ''
  return title || UNTITLED
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns `null` for a missing file. An unreadable file is kept next to the original as `.corrupt` before it gets overwritten. */
async function readJson(file: string): Promise<unknown> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    await fs.copyFile(file, `${file}.corrupt`).catch(() => undefined)
    return null
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(data), 'utf8')
  // Windows briefly locks files that antivirus or the indexer is reading; a short retry gets past it.
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(temp, file)
      return
    } catch (error) {
      const code = errorCode(error)
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 40))
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}
