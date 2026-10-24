import { contextBridge, ipcRenderer } from 'electron'
import { Channel } from '../shared/channels'
import type { AppCommand, DotoApi } from '../shared/types'

const api: DotoApi = {
  loadLibrary: () => ipcRenderer.invoke(Channel.loadLibrary),
  setTheme: (theme) => ipcRenderer.invoke(Channel.setTheme, theme),
  setAutoSave: (enabled, minutes) => ipcRenderer.invoke(Channel.setAutoSave, enabled, minutes),
  chooseSaveFolder: () => ipcRenderer.invoke(Channel.chooseSaveFolder),
  clearSaveFolder: () => ipcRenderer.invoke(Channel.clearSaveFolder),
  listBackups: () => ipcRenderer.invoke(Channel.listBackups),
  restoreBackup: (slot) => ipcRenderer.invoke(Channel.restoreBackup, slot),
  createSave: () => ipcRenderer.invoke(Channel.createSave),
  renameSave: (id, title) => ipcRenderer.invoke(Channel.renameSave, id, title),
  openSave: (id) => ipcRenderer.invoke(Channel.openSave, id),
  deleteSave: (id) => ipcRenderer.invoke(Channel.deleteSave, id),
  createTab: () => ipcRenderer.invoke(Channel.createTab),
  openTab: (id) => ipcRenderer.invoke(Channel.openTab, id),
  reorderTabs: (ids) => ipcRenderer.invoke(Channel.reorderTabs, ids),
  readTab: (id) => ipcRenderer.invoke(Channel.readTab, id),
  saveTab: (tab) => ipcRenderer.invoke(Channel.saveTab, tab),
  archiveTab: (id) => ipcRenderer.invoke(Channel.archiveTab, id),
  trashModule: (module) => ipcRenderer.invoke(Channel.trashModule, module),
  trashAudio: (src) => ipcRenderer.invoke(Channel.trashAudio, src),
  restoreArchived: (id) => ipcRenderer.invoke(Channel.restoreArchived, id),
  deleteArchived: (id) => ipcRenderer.invoke(Channel.deleteArchived, id),
  emptyTrash: () => ipcRenderer.invoke(Channel.emptyTrash),
  setStatusBar: (settings) => ipcRenderer.invoke(Channel.setStatusBar, settings),
  setDock: (layout) => ipcRenderer.invoke(Channel.setDock, layout),
  setKeybinds: (keybinds) => ipcRenderer.invoke(Channel.setKeybinds, keybinds),
  setShortcutCapture: (on) => ipcRenderer.invoke(Channel.setShortcutCapture, on),
  setTabColor: (id, color) => ipcRenderer.invoke(Channel.setTabColor, id, color),
  pickImages: (tabId) => ipcRenderer.invoke(Channel.pickImages, tabId),
  pickVideo: (tabId) => ipcRenderer.invoke(Channel.pickVideo, tabId),
  saveAudio: (tabId, bytes) => ipcRenderer.invoke(Channel.saveAudio, tabId, bytes),
  claimEditorMenu: () => {
    ipcRenderer.sendSync(Channel.claimEditorMenu)
  },
  onSaveRequest: (save) => {
    const listener = (): void => {
      void save()
    }
    ipcRenderer.on(Channel.saveRequest, listener)
    return () => {
      ipcRenderer.removeListener(Channel.saveRequest, listener)
    }
  },
  onCommand: (run) => {
    const listener = (_event: unknown, command: AppCommand): void => {
      if (command === 'marker' || command === 'notes' || command === 'todo' || command === 'eraser') run(command)
    }
    ipcRenderer.on(Channel.command, listener)
    return () => {
      ipcRenderer.removeListener(Channel.command, listener)
    }
  },
  checkForUpdate: () => ipcRenderer.invoke(Channel.checkUpdate),
  onCloseRequest: (flush) => {
    const listener = (): void => {
      void flush()
        .catch(() => undefined)
        .then(() => ipcRenderer.send(Channel.closeReady))
    }
    ipcRenderer.on(Channel.closeRequest, listener)
    return () => {
      ipcRenderer.removeListener(Channel.closeRequest, listener)
    }
  }
}

contextBridge.exposeInMainWorld('doto', api)
