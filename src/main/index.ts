import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, session, shell } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions, WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Channel } from '../shared/channels'
import { APP_COMMANDS, eventMatches } from '../shared/keys'
import type { Theme } from '../shared/types'
import { appIcon } from './icon'
import * as storage from './storage'
import { checkForUpdate } from './update'

const APP_ID = 'com.kuremi.doto'
// YouTube refuses to play embeds that arrive without a Referer (error 153), and pages loaded from file:// send none.
const EMBED_REFERER = `https://${APP_ID}/`
const YOUTUBE_URLS = ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*']
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])
const BACKGROUND: Record<Theme, string> = { light: '#f7f5f0', dark: '#17181a' }
const CLOSE_TIMEOUT_MS = 3000
let editorMenuClaimed = false

protocol.registerSchemesAsPrivileged([
  { scheme: storage.ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
let quitting = false

// A second copy of the app would write the same files from a separate queue.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  void app.whenReady().then(start)
}

async function start(): Promise<void> {
  app.setAppUserModelId(APP_ID)
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  registerAssetProtocol()
  configureSession()
  registerIpc()
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}

async function createWindow(): Promise<void> {
  const { theme } = await storage.loadLibrary()
  nativeTheme.themeSource = theme

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Doto',
    icon: appIcon(theme),
    backgroundColor: BACKGROUND[theme],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  guardNavigation(win.webContents)
  attachContextMenu(win.webContents)
  saveBeforeClose(win)
  bindKeys(win)

  const devServer = process.env.ELECTRON_RENDERER_URL
  const loaded = !app.isPackaged && devServer ? win.loadURL(devServer) : win.loadFile(join(__dirname, '../renderer/index.html'))
  loaded.catch((error: unknown) => console.error('Failed to load the renderer', error))
}

function registerAssetProtocol(): void {
  protocol.handle(storage.ASSET_SCHEME, async (request) => {
    try {
      const file = storage.resolveAssetPath(request.url)
      if (file) return await net.fetch(pathToFileURL(file).toString())
    } catch {
      // Missing or malformed asset; fall through to 404.
    }
    return new Response(null, { status: 404 })
  })
}

function configureSession(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_URLS }, (details, callback) => {
    const requestHeaders = details.requestHeaders
    if (!details.referrer && !requestHeaders.Referer) requestHeaders.Referer = EMBED_REFERER
    callback({ requestHeaders })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
}

function registerIpc(): void {
  handle(Channel.loadLibrary, () => storage.loadLibrary())
  handle(Channel.setTheme, (theme) => {
    const next: Theme = theme === 'dark' ? 'dark' : 'light'
    nativeTheme.themeSource = next
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setIcon(appIcon(next))
    }
    return storage.setTheme(next)
  })
  handle(Channel.setAutoSave, (enabled, minutes) => storage.setAutoSave(enabled === true, minutes))
  handle(Channel.chooseSaveFolder, () => chooseSaveFolder())
  handle(Channel.clearSaveFolder, () => storage.setExportDir(null))
  handle(Channel.listBackups, () => storage.listBackups())
  handle(Channel.restoreBackup, (slot) => storage.restoreBackup(slot === 2 ? 2 : 1))
  handle(Channel.createSave, () => storage.createSave())
  handle(Channel.renameSave, (id, title) => storage.renameSave(pageId(id), title))
  handle(Channel.openSave, (id) => storage.openSave(pageId(id)))
  handle(Channel.deleteSave, (id) => storage.deleteSave(pageId(id)))
  handle(Channel.createTab, () => storage.createTab())
  handle(Channel.openTab, (id) => storage.openTab(pageId(id)))
  handle(Channel.reorderTabs, (ids) => storage.reorderTabs(ids))
  handle(Channel.readTab, (id) => storage.readTab(pageId(id)))
  handle(Channel.saveTab, (tab) => storage.saveTab(tab))
  handle(Channel.archiveTab, (id) => storage.archiveTab(pageId(id)))
  handle(Channel.trashModule, (module) => storage.trashModule(module))
  handle(Channel.restoreArchived, (id) => storage.restoreArchived(pageId(id)))
  handle(Channel.deleteArchived, (id) => storage.deleteArchived(pageId(id)))
  handle(Channel.emptyTrash, () => storage.emptyTrash())
  handle(Channel.setStatusBar, (settings) => storage.setStatusBar(settings))
  handle(Channel.setDock, (layout) => storage.setDock(layout))
  handle(Channel.setKeybinds, (keybinds) => storage.setKeybinds(keybinds))
  handle(Channel.setShortcutCapture, (on) => storage.setShortcutCapture(on === true))
  handle(Channel.setTabColor, (id, color) => storage.setTabColor(pageId(id), color === 'sand' || color === 'blue' || color === 'green' || color === 'rose' || color === 'amber' || color === 'violet' ? color : 'default'))
  handle(Channel.pickImages, (id) => pickImages(pageId(id)))
  handle(Channel.pickVideo, (id) => pickVideo(pageId(id)))
  handle(Channel.checkUpdate, () => checkForUpdate())
  ipcMain.on(Channel.claimEditorMenu, (event) => {
    const trusted = mainWindow !== null && event.sender === mainWindow.webContents && event.senderFrame?.parent === null
    if (trusted) editorMenuClaimed = true
    event.returnValue = trusted
  })
}

function handle(channel: string, listener: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!fromAppFrame(event)) throw new Error(`Rejected ${channel} from an untrusted frame`)
    return listener(...args)
  })
}

function fromAppFrame(event: IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents && event.senderFrame?.parent === null
}

function pageId(value: unknown): string {
  if (!storage.isPageId(value)) throw new Error('Invalid page id')
  return value
}

async function chooseSaveFolder(): Promise<Awaited<ReturnType<typeof storage.setExportDir>> | null> {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for this save',
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return storage.setExportDir(result.filePaths[0])
}

async function pickImages(id: string): Promise<string[]> {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Insert images',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: storage.IMAGE_EXTENSIONS },
      { name: 'GIF', extensions: ['gif'] }
    ]
  })
  return result.canceled ? [] : storage.importImages(id, result.filePaths)
}

async function pickVideo(id: string): Promise<string | null> {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Upload a video',
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: storage.VIDEO_EXTENSIONS }]
  })
  if (result.canceled) return null
  const [src] = await storage.importVideos(id, result.filePaths)
  return src ?? null
}

/** Ctrl+S never reaches the page: Chromium treats it as Save Page. Catch it here and save the note. */
function bindKeys(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    if (!app.isPackaged && input.key === 'F12') {
      win.webContents.toggleDevTools()
      return
    }
    if (storage.isShortcutCapture()) return
    const pressed = {
      key: input.key,
      code: input.code,
      ctrl: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift
    }
    const binds = storage.currentKeybinds()
    if (eventMatches(binds.save, pressed)) {
      event.preventDefault()
      if (!win.isDestroyed()) win.webContents.send(Channel.saveRequest)
      return
    }
    const command = APP_COMMANDS.find((name) => eventMatches(binds[name], pressed))
    if (!command) return
    event.preventDefault()
    if (!win.isDestroyed()) win.webContents.send(Channel.command, command)
  })
}

function guardNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event) => {
    if (event.url === contents.getURL()) return
    event.preventDefault()
    openExternal(event.url)
  })
}

function openExternal(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

function attachContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    if (editorMenuClaimed) {
      editorMenuClaimed = false
      return
    }
    const template: MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 5).map((word) => ({
      label: word,
      click: () => contents.replaceMisspelling(word)
    }))
    if (params.misspelledWord) {
      template.push(
        { label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' }
      )
    }
    if (params.isEditable) {
      template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    } else if (params.selectionText) {
      template.push({ role: 'copy' })
    }
    if (template.length > 0) Menu.buildFromTemplate(template).popup()
  })
}

/** Gives the renderer a chance to write pending edits before the window goes away. */
function saveBeforeClose(win: BrowserWindow): void {
  let allowed = false
  let waiting = false
  win.on('close', (event) => {
    if (allowed) return
    event.preventDefault()
    if (waiting) return
    waiting = true

    const finish = (): void => {
      ipcMain.removeListener(Channel.closeReady, onReady)
      clearTimeout(timer)
      void storage.whenIdle().then(() => {
        allowed = true
        if (quitting) app.quit()
        else if (!win.isDestroyed()) win.close()
      })
    }
    const onReady = (readyEvent: IpcMainEvent): void => {
      if (readyEvent.sender === win.webContents) finish()
    }
    const timer = setTimeout(finish, CLOSE_TIMEOUT_MS)
    ipcMain.on(Channel.closeReady, onReady)

    if (win.webContents.isCrashed()) finish()
    else win.webContents.send(Channel.closeRequest)
  })
}
