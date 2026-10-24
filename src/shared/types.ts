export const THEME_IDS = [
  'light',
  'dark',
  'pink-light',
  'pink-dark',
  'cyan-light',
  'cyan-dark',
  'matcha-light',
  'matcha-dark',
  'lavender-light',
  'lavender-dark',
  'peach-light',
  'peach-dark'
] as const
export type Theme = (typeof THEME_IDS)[number]

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

/** Window chrome and the app icon follow light or dark, including the pastel variants. */
export function isDarkTheme(theme: Theme): boolean {
  return theme === 'dark' || theme.endsWith('-dark')
}

/** Colors for the theme menu and the window title bar. */
export const THEME_SWATCHES: Record<Theme, { label: string; ground: string; surface: string; text: string; accent: string; border: string }> = {
  light: { label: 'Light', ground: '#f7f5f0', surface: '#ffffff', text: '#24231f', accent: '#4f63e7', border: '#e4e0d6' },
  dark: { label: 'Dark', ground: '#17181a', surface: '#202124', text: '#e9e7e3', accent: '#8d9dff', border: '#313338' },
  'pink-light': { label: 'Pastel Pink · Light', ground: '#fff8fa', surface: '#ffffff', text: '#3d2b33', accent: '#e0668f', border: '#f3d9e2' },
  'pink-dark': { label: 'Pastel Pink · Dark', ground: '#1a1317', surface: '#251821', text: '#f6e6ec', accent: '#f28aae', border: '#3a2a33' },
  'cyan-light': { label: 'Cyan · Light', ground: '#f5fcfd', surface: '#ffffff', text: '#1f3338', accent: '#1b8fa5', border: '#cfebf0' },
  'cyan-dark': { label: 'Cyan · Dark', ground: '#0f1a1d', surface: '#162428', text: '#e4f6f9', accent: '#5cd3e6', border: '#264146' },
  'matcha-light': { label: 'Matcha · Light', ground: '#f7faf2', surface: '#ffffff', text: '#2b3524', accent: '#6b9340', border: '#dce7cc' },
  'matcha-dark': { label: 'Matcha · Dark', ground: '#161a10', surface: '#1c2517', text: '#eaf2df', accent: '#a6ce74', border: '#354228' },
  'lavender-light': { label: 'Lavender · Light', ground: '#fafaff', surface: '#ffffff', text: '#2f2a40', accent: '#7b72d6', border: '#e3ddf5' },
  'lavender-dark': { label: 'Lavender · Dark', ground: '#16131f', surface: '#1f1b2c', text: '#eeeafa', accent: '#b7a2f5', border: '#352f52' },
  'peach-light': { label: 'Peach · Light', ground: '#fff9f5', surface: '#ffffff', text: '#3b2a22', accent: '#e0764a', border: '#f8dfd0' },
  'peach-dark': { label: 'Peach · Dark', ground: '#1c1411', surface: '#271c17', text: '#fbede5', accent: '#f5a67e', border: '#4a342b' }
}

export const ARCHIVE_DAYS = 7

export const MODULE_COLORS = ['default', 'sand', 'blue', 'green', 'rose', 'amber', 'violet'] as const
export type ModuleColor = (typeof MODULE_COLORS)[number]
export type ModuleKind = 'todo' | 'notes'

export interface TodoItem {
  id: string
  text: string
  done: boolean
}

export interface ModuleRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ModuleInstance {
  id: string
  kind: ModuleKind
  title: string
  color: ModuleColor
  /** Locked in place: the window cannot be dragged or resized. */
  pinned: boolean
  rect: ModuleRect
  todos: TodoItem[]
  /** Rich text for a notes window, and the media area under a to-do list. */
  content: NoteContent | null
}

/** Where the writing column sits on the notepad. `null` keeps it centered. */
export interface TextFrame {
  x: number
  width: number
}

/** TipTap document JSON, kept loose so the main process does not depend on the editor. */
export type NoteContent = Record<string, unknown>

export type InkTool = 'pen' | 'highlighter' | 'eraser'

export interface InkPoint {
  x: number
  y: number
}

/** A freehand mark. `note` is the page, `note-frame` the writing column, `module:<id>` a window, and `media:<id>` an image or video. */
export interface InkStroke {
  id: string
  surface: string
  tool: InkTool
  color: string
  size: number
  /** Width of an image or video when the stroke was drawn, so the mark scales with it. */
  basis?: number
  points: InkPoint[]
}

export interface Tab {
  id: string
  title: string
  content: NoteContent | null
  /** `null` until the writing column is dragged off center. */
  textFrame: TextFrame | null
  modules: ModuleInstance[]
  color: ModuleColor
  ink: InkStroke[]
  createdAt: number
  updatedAt: number
}

export const DOCK_IDS = ['save', 'marker', 'search', 'frame', 'todo', 'notes', 'image', 'video', 'audio'] as const
export type DockItemId = (typeof DOCK_IDS)[number]
export type DockSide = 'left' | 'center' | 'right'

export interface DockLayout {
  left: DockItemId[]
  center: DockItemId[]
  right: DockItemId[]
}

export interface Keybinds {
  save: string
  find: string
  marker: string
  notes: string
  todo: string
  eraser: string
}

export type AppCommand = 'marker' | 'notes' | 'todo' | 'eraser'

export interface TabSummary {
  id: string
  title: string
  /** Tasks that are not done, last saved with this tab. */
  openTasks: number
  /** Words in the note, last saved with this tab. */
  words: number
  color: ModuleColor
}

export interface StatusBarSettings {
  /** Unfinished tasks on the tab that is open. */
  currentTab: boolean
  /** Unfinished tasks in the whole save, as one number. */
  saveTasks: boolean
  /** Words across the open save. */
  words: boolean
}

/** A save is the directory that holds a notepad's tabs. */
export interface SaveSummary {
  id: string
  title: string
  tabs: TabSummary[]
  activeTabId: string
  updatedAt: number
  /** Folder where this save’s Word documents are written. Other saves keep their own folder. */
  exportDir: string | null
  /** Last `.docx` file name written for each tab, so a rename can replace the old file. */
  exportFiles: Record<string, string>
}

export interface ArchivedNote {
  id: string
  saveId: string
  saveTitle: string
  title: string
  content: NoteContent | null
  modules: ModuleInstance[]
  color: ModuleColor
  ink: InkStroke[]
  /** A closed tab, a notes or to-do window, or a voice note removed from the page. */
  kind: 'tab' | ModuleKind | 'audio'
  createdAt: number
  archivedAt: number
}

export interface Library {
  saves: SaveSummary[]
  activeSaveId: string
  theme: Theme
  archive: ArchivedNote[]
  autoSave: boolean
  /** How often autosave writes, when it is turned on. */
  autoSaveMinutes: number
  statusBar: StatusBarSettings
  dock: DockLayout
  keybinds: Keybinds
}

export interface SaveBackup {
  slot: 1 | 2
  savedAt: number
  title: string
}

/** Result of comparing this build with the latest GitHub release. */
export type UpdateCheck =
  | { state: 'current'; version: string }
  | { state: 'available'; version: string; url: string }
  | { state: 'none' }
  | { state: 'error' }

/** A library plus the tab that should be on screen. */
export interface Opened {
  library: Library
  tab: Tab
}

export interface DotoApi {
  loadLibrary(): Promise<Library>
  setTheme(theme: Theme): Promise<void>
  setAutoSave(enabled: boolean, minutes: number): Promise<void>
  /** Opens a folder picker and stores that folder on the save that is open. */
  chooseSaveFolder(): Promise<Library | null>
  /** Clears the document folder for the save that is open. */
  clearSaveFolder(): Promise<Library>
  listBackups(): Promise<SaveBackup[]>
  restoreBackup(slot: 1 | 2): Promise<Opened>
  createSave(): Promise<Opened>
  renameSave(id: string, title: string): Promise<Library>
  openSave(id: string): Promise<Opened>
  /** Moves every note in the save to the trash, then removes the save. */
  deleteSave(id: string): Promise<Opened>
  createTab(): Promise<Opened>
  openTab(id: string): Promise<Opened>
  reorderTabs(ids: string[]): Promise<Library>
  readTab(id: string): Promise<Tab>
  /** Resolves to `null` when the tab no longer exists. */
  saveTab(tab: Tab): Promise<TabSummary | null>
  archiveTab(id: string): Promise<Opened>
  /** Keeps a closed notes or to-do window in the trash. */
  trashModule(module: ModuleInstance): Promise<Library>
  /** Copies a voice note into the trash. The file is removed from the note's folder. */
  trashAudio(src: string): Promise<Library | null>
  restoreArchived(id: string): Promise<Opened>
  deleteArchived(id: string): Promise<Library>
  emptyTrash(): Promise<Library>
  setStatusBar(settings: StatusBarSettings): Promise<void>
  setDock(layout: DockLayout): Promise<void>
  setKeybinds(keybinds: Keybinds): Promise<void>
  /** Lets the window deliver the next shortcut to the page while a keybind is being recorded. */
  setShortcutCapture(on: boolean): Promise<void>
  setTabColor(id: string, color: ModuleColor): Promise<Library>
  /** Opens the file picker and copies the chosen images into the tab's asset folder. */
  pickImages(tabId: string): Promise<string[]>
  /** Opens a file picker and copies the chosen video into the tab's asset folder. */
  pickVideo(tabId: string): Promise<string | null>
  /** Stores a recorded clip in the tab's asset folder and returns its asset URL. */
  saveAudio(tabId: string, bytes: Uint8Array): Promise<string | null>
  /** Tells the main process this right-click already opened an editor menu. */
  claimEditorMenu(): void
  /** Ctrl+S is caught by the window, because the page never receives that key. */
  onSaveRequest(save: () => Promise<void>): () => void
  /** A shortcut the window handles itself, so the page cannot also type it. */
  onCommand(run: (command: AppCommand) => void): () => void
  /** Runs `flush` before the window closes. Returns an unsubscribe function. */
  onCloseRequest(flush: () => Promise<void>): () => void
  /** Reads the latest public GitHub release. Does not download it. */
  checkForUpdate(): Promise<UpdateCheck>
}
