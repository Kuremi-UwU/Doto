import { create } from 'zustand'
import { DEFAULT_DOCK } from '../../shared/dock'
import { DEFAULT_KEYBINDS, normalizeKeybinds } from '../../shared/keys'
import type { DockLayout, InkStroke, InkTool, Keybinds, Library, ModuleColor, ModuleInstance, NoteContent, SaveSummary, StatusBarSettings, Tab, TextFrame, Theme, TodoItem } from '../../shared/types'
import { applyPageContent, snapshotEditors } from './editor/snapshot'

const SAVE_DELAY_MS = 400
const RETRY_DELAY_MS = 2000
const MAX_TITLE_LENGTH = 120

type Status = 'loading' | 'ready' | 'unavailable' | 'error'

interface DotoState {
  status: Status
  saves: SaveSummary[]
  activeSaveId: string
  archive: Library['archive']
  theme: Theme
  autoSave: boolean
  autoSaveMinutes: number
  statusBar: StatusBarSettings
  dock: DockLayout
  keybinds: Keybinds
  marker: { active: boolean; tool: InkTool; color: string; size: number; eraserSize: number }
  tab: Tab | null
  dirty: boolean
  saveFailed: boolean
  init: () => Promise<void>
  openSave: (id: string) => Promise<void>
  deleteSave: (id: string) => Promise<void>
  createSave: () => Promise<void>
  renameSave: (title: string) => void
  openTab: (id: string) => Promise<void>
  reorderTabs: (ids: string[]) => void
  createTab: () => Promise<void>
  renameTab: (title: string) => void
  archiveTab: (id: string) => Promise<void>
  trashModule: (module: ModuleInstance) => Promise<void>
  trashAudio: (src: string) => Promise<boolean>
  restoreArchived: (id: string) => Promise<void>
  deleteArchived: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  setStatusBar: (settings: StatusBarSettings) => void
  setDock: (layout: DockLayout) => void
  setKeybinds: (keybinds: Keybinds) => void
  setTabColor: (id: string, color: ModuleColor) => void
  toggleMarker: () => void
  setMarker: (patch: Partial<{ tool: InkTool; color: string; size: number; eraserSize: number }>) => void
  setInk: (ink: InkStroke[]) => void
  setContent: (content: NoteContent) => void
  setTextFrame: (frame: TextFrame) => void
  addModule: (module: ModuleInstance) => void
  removeModule: (id: string) => void
  updateModule: (id: string, update: (module: ModuleInstance) => ModuleInstance) => void
  setTheme: (theme: Theme) => void
  setAutoSave: (enabled: boolean, minutes: number) => void
  chooseSaveFolder: () => Promise<void>
  clearSaveFolder: () => Promise<void>
  restoreBackup: (slot: 1 | 2) => Promise<void>
  flush: () => Promise<void>
  /** Ctrl+S. Writes the open note and shows Saved. */
  saveNow: () => Promise<void>
  savedAt: number
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let autoTimer: ReturnType<typeof setInterval> | undefined
let saveChain: Promise<void> = Promise.resolve()
let saveQueued = false
let saveAnnounced = false
// Bumped by every tab switch so a slow read cannot replace a note the user has already moved past.
let navigation = 0
let initialized = false

export const useDoto = create<DotoState>()((set, get) => {
  const schedule = (delay = SAVE_DELAY_MS): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void persist(), delay)
  }

  const persist = (announce = false): Promise<void> => {
    clearTimeout(saveTimer)
    saveAnnounced = saveAnnounced || announce
    if (saveQueued) return saveChain
    saveQueued = true
    saveChain = saveChain.then(async () => {
      const announceThis = saveAnnounced
      saveAnnounced = false
      saveQueued = false
      snapshotEditors()
      const { tab, dirty } = get()
      if (!tab || (!dirty && !announceThis)) return
      set({ dirty: false })
      try {
        const summary = await window.doto.saveTab(tab)
        set((state) => ({
          saveFailed: false,
          savedAt: announceThis ? Date.now() : state.savedAt,
          saves: summary
            ? state.saves.map((save) =>
                save.tabs.some((item) => item.id === summary.id)
                  ? { ...save, updatedAt: Date.now(), tabs: save.tabs.map((item) => (item.id === summary.id ? summary : item)) }
                  : save
              )
            : state.saves
        }))
      } catch {
        set({ dirty: true, saveFailed: true })
        schedule(RETRY_DELAY_MS)
      }
    })
    return saveChain
  }

  const edit = (patch: Partial<Tab>): void => {
    const { tab } = get()
    if (!tab) return
    set({ tab: { ...tab, ...patch }, dirty: true })
  }

  const armAutoSave = (): void => {
    clearInterval(autoTimer)
    const { autoSave, autoSaveMinutes } = get()
    if (!autoSave) return
    autoTimer = setInterval(() => void persist(), autoSaveMinutes * 60 * 1000)
  }

  const applyLibrary = (library: Library): void => {
    set({
      saves: library.saves,
      activeSaveId: library.activeSaveId,
      archive: library.archive,
      theme: library.theme,
      autoSave: library.autoSave,
      autoSaveMinutes: library.autoSaveMinutes,
      statusBar: library.statusBar,
      dock: library.dock,
      keybinds: library.keybinds
    })
    armAutoSave()
  }

  /** Saves the open tab, then swaps in the next one unless another switch started meanwhile. */
  const switchTo = async (load: () => Promise<{ library: Library; tab: Tab }>): Promise<void> => {
    const request = ++navigation
    await persist()
    if (get().saveFailed || request !== navigation) return
    const opened = await load()
    if (request !== navigation) return
    if (get().dirty) await persist()
    if (request !== navigation) return
    const library = opened.library
    set({
      saves: library.saves,
      activeSaveId: library.activeSaveId,
      archive: library.archive,
      theme: library.theme,
      autoSave: library.autoSave,
      autoSaveMinutes: library.autoSaveMinutes,
      statusBar: library.statusBar,
      dock: library.dock,
      keybinds: library.keybinds,
      tab: opened.tab,
      dirty: false,
      saveFailed: false
    })
    armAutoSave()
  }

  return {
    status: 'loading',
    saves: [],
    activeSaveId: '',
    archive: [],
    theme: 'light',
    autoSave: false,
    autoSaveMinutes: 5,
    statusBar: { currentTab: true, saveTasks: true, words: true },
    dock: DEFAULT_DOCK,
    keybinds: DEFAULT_KEYBINDS,
    marker: { active: false, tool: 'pen', color: '#1c1b19', size: 4, eraserSize: 16 },
    tab: null,
    dirty: false,
    saveFailed: false,
    savedAt: 0,

    init: async () => {
      if (initialized) return
      initialized = true
      if (!window.doto) {
        set({ status: 'unavailable' })
        return
      }
      try {
        const library = await window.doto.loadLibrary()
        const save = library.saves.find((entry) => entry.id === library.activeSaveId) ?? library.saves[0]
        const tab = await window.doto.readTab(save.activeTabId)
        set({
          status: 'ready',
          saves: library.saves,
          activeSaveId: library.activeSaveId,
          archive: library.archive,
          theme: library.theme,
          autoSave: library.autoSave,
          autoSaveMinutes: library.autoSaveMinutes,
          statusBar: library.statusBar,
          dock: library.dock,
          keybinds: library.keybinds,
          tab
        })
        armAutoSave()
      } catch {
        set({ status: 'error' })
      }
    },

    openSave: async (id) => {
      if (get().activeSaveId === id) return
      try {
        await switchTo(() => window.doto.openSave(id))
      } catch {
        // The save vanished from disk; keep showing the current one.
      }
    },

    deleteSave: async (id) => {
      const current = get().activeSaveId === id
      const request = current ? ++navigation : navigation
      await persist()
      const opened = await window.doto.deleteSave(id)
      applyLibrary(opened.library)
      if (current && request === navigation) set({ tab: opened.tab, dirty: false, saveFailed: false })
    },

    createSave: async () => {
      await switchTo(() => window.doto.createSave())
    },

    renameSave: (title) => {
      const { activeSaveId, saves } = get()
      const save = saves.find((entry) => entry.id === activeSaveId)
      if (!save) return
      const clean = title.trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled'
      if (clean === save.title) return
      set({
        saves: saves.map((entry) => (entry.id === save.id ? { ...entry, title: clean } : entry))
      })
      void window.doto.renameSave(save.id, clean).then((library) => applyLibrary(library))
    },

    openTab: async (id) => {
      if (get().tab?.id === id) return
      try {
        await switchTo(() => window.doto.openTab(id))
      } catch {
        // The tab vanished from disk; keep showing the current one.
      }
    },

    reorderTabs: (ids) => {
      const { activeSaveId } = get()
      set((state) => ({
        saves: state.saves.map((save) => {
          if (save.id !== activeSaveId) return save
          const next = ids.flatMap((id) => {
            const tab = save.tabs.find((item) => item.id === id)
            return tab ? [tab] : []
          })
          return next.length === save.tabs.length ? { ...save, tabs: next } : save
        })
      }))
      void window.doto.reorderTabs(ids).then((library) => applyLibrary(library))
    },

    createTab: async () => {
      await switchTo(() => window.doto.createTab())
    },

    renameTab: (title) => {
      const { tab } = get()
      if (!tab) return
      const clean = title.trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled'
      if (clean === tab.title) return
      set((state) => ({
        saves: state.saves.map((save) => ({
          ...save,
          tabs: save.tabs.map((item) => (item.id === tab.id ? { ...item, title: clean } : item))
        }))
      }))
      edit({ title: clean })
    },

    archiveTab: async (id) => {
      const current = get().tab?.id === id
      const request = current ? ++navigation : navigation
      await persist()
      const opened = await window.doto.archiveTab(id)
      applyLibrary(opened.library)
      if (current && request === navigation) set({ tab: opened.tab, dirty: false, saveFailed: false })
    },

    trashModule: async (module) => {
      const library = await window.doto.trashModule(module)
      applyLibrary(library)
    },

    trashAudio: async (src) => {
      const library = await window.doto.trashAudio(src)
      if (!library) return false
      applyLibrary(library)
      return true
    },

    restoreArchived: async (id) => {
      const previous = get().tab?.id
      await switchTo(() => window.doto.restoreArchived(id))
      const tab = get().tab
      if (tab && tab.id === previous) applyPageContent(tab.content)
    },

    deleteArchived: async (id) => {
      const library = await window.doto.deleteArchived(id)
      applyLibrary(library)
    },

    emptyTrash: async () => {
      applyLibrary(await window.doto.emptyTrash())
    },

    setStatusBar: (settings) => {
      set({ statusBar: settings })
      void window.doto.setStatusBar(settings)
    },

    setDock: (layout) => {
      set({ dock: layout })
      void window.doto.setDock(layout)
    },

    setKeybinds: (keybinds) => {
      const next = normalizeKeybinds(keybinds)
      set({ keybinds: next })
      void window.doto.setKeybinds(next)
    },

    setTabColor: (id, color) => {
      const live = get().tab?.id === id
      set((state) => ({
        tab: live && state.tab ? { ...state.tab, color } : state.tab,
        dirty: live ? true : state.dirty,
        saves: state.saves.map((save) => ({
          ...save,
          tabs: save.tabs.map((item) => (item.id === id ? { ...item, color } : item))
        }))
      }))
      if (!live) void window.doto.setTabColor(id, color).then((library) => applyLibrary(library))
    },

    toggleMarker: () => set((state) => ({ marker: { ...state.marker, active: !state.marker.active } })),

    setMarker: (patch) => set((state) => ({ marker: { ...state.marker, ...patch, active: true } })),

    setInk: (ink) => edit({ ink }),

    setContent: (content) => edit({ content }),

    setTextFrame: (frame) => edit({ textFrame: frame }),

    addModule: (module) => {
      const { tab } = get()
      if (!tab) return
      edit({ modules: [...tab.modules, module] })
    },

    removeModule: (id) => {
      const { tab } = get()
      if (!tab) return
      edit({ modules: tab.modules.filter((module) => module.id !== id) })
    },

    updateModule: (id, update) => {
      const { tab } = get()
      if (!tab) return
      let changed = false
      const modules = tab.modules.map((module) => {
        if (module.id !== id) return module
        const next = update(module)
        if (next !== module) changed = true
        return next
      })
      if (changed) edit({ modules })
    },

    setTheme: (theme) => {
      set({ theme })
      void window.doto.setTheme(theme)
    },

    chooseSaveFolder: async () => {
      const library = await window.doto.chooseSaveFolder()
      if (library) applyLibrary(library)
    },

    clearSaveFolder: async () => {
      applyLibrary(await window.doto.clearSaveFolder())
    },

    setAutoSave: (enabled, minutes) => {
      const autoSaveMinutes = Math.min(180, Math.max(1, Math.round(minutes) || 5))
      set({ autoSave: enabled, autoSaveMinutes })
      armAutoSave()
      void window.doto.setAutoSave(enabled, autoSaveMinutes)
    },

    restoreBackup: async (slot) => {
      await switchTo(() => window.doto.restoreBackup(slot))
    },

    flush: () => persist(),
    saveNow: () => persist(true)
  }
})

export function updateTodos(moduleId: string, update: (todos: TodoItem[]) => TodoItem[]): void {
  useDoto.getState().updateModule(moduleId, (module) => {
    const todos = update(module.todos)
    return todos === module.todos ? module : { ...module, todos }
  })
}
