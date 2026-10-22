export type Theme = 'light' | 'dark'

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

export const DOCK_IDS = ['save', 'marker', 'search', 'frame', 'todo', 'notes', 'image', 'video'] as const
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
  /** A closed tab, or a notes or to-do window that was closed. */
  kind: 'tab' | ModuleKind
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
