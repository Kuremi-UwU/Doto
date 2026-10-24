import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { AppCommand, ModuleColor, ModuleInstance, ModuleKind } from '../../shared/types'
import BottomBar from './components/BottomBar'
import ModuleWindow, { stackedWindowRect, type Size } from './components/ModuleWindow'
import { EraserCursor } from './components/InkLayer'
import Notepad from './components/Notepad'
import NotesModule from './components/NotesModule'
import ConfirmDialog from './components/ConfirmDialog'
import SearchBar from './components/SearchBar'
import TodoModule, { TodoMeta } from './components/TodoModule'
import TopBar from './components/TopBar'
import VideoDialog from './components/VideoDialog'
import { getActiveEditor, useActiveEditor } from './editor/active'
import { insertLocalVideo, insertVideo } from './editor/extensions'
import { eventMatches } from '../../shared/keys'
import { moduleHasInformation } from '../../shared/stats'
import { isRecordingShortcut } from './keybindLock'
import { useDoto } from './store'

export default function App(): React.JSX.Element {
  const status = useDoto((state) => state.status)
  const theme = useDoto((state) => state.theme)
  const tabId = useDoto((state) => state.tab?.id)
  const title = useDoto((state) => state.tab?.title)
  const modules = useDoto((state) => state.tab?.modules ?? EMPTY_MODULES)
  const addModule = useDoto((state) => state.addModule)
  const updateModule = useDoto((state) => state.updateModule)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [videoEditor, setVideoEditor] = useState<Editor | null>(null)
  const [videoOpen, setVideoOpen] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const focusedEditor = useActiveEditor()
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const bounds = useElementSize(layer)
  const commandRef = useRef<(command: AppCommand) => void>(() => undefined)
  const closedModule = useRef<{ module: ModuleInstance; trashId: string | null } | null>(null)

  useEffect(() => {
    closedModule.current = null
  }, [tabId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      if (!(event.ctrlKey || event.metaKey)) return
      const closed = closedModule.current
      if (!closed) return
      event.preventDefault()
      closedModule.current = null
      useDoto.getState().addModule(closed.module)
      if (closed.trashId) void useDoto.getState().deleteArchived(closed.trashId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    void useDoto.getState().init()
  }, [])

  useEffect(() => {
    if (status !== 'ready') return undefined
    return window.doto.onCloseRequest(() => useDoto.getState().flush())
  }, [status])

  useEffect(() => {
    document.title = title ? `Doto, ${title}` : 'Doto'
  }, [title])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (navigator.userAgent.includes('Windows')) document.documentElement.dataset.platform = 'win32'
  }, [theme])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat || isRecordingShortcut()) return
      const input = { key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }
      const binds = useDoto.getState().keybinds
      if (eventMatches(binds.save, input)) {
        event.preventDefault()
        void useDoto.getState().saveNow()
      } else if (eventMatches(binds.find, input)) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (!window.doto) return undefined
    return window.doto.onSaveRequest(() => useDoto.getState().saveNow())
  }, [])

  useEffect(() => {
    if (!window.doto) return undefined
    return window.doto.onCommand((command) => commandRef.current(command))
  }, [])

  if (status === 'unavailable') {
    return (
      <p className="app-message">
        Doto runs as a desktop app. Start it with <code>npm run dev</code>.
      </p>
    )
  }
  if (status === 'error') return <p className="app-message">Doto could not open your notes folder.</p>
  if (status !== 'ready' || !tabId) return <div className="app-message" />

  const openModule = (kind: ModuleKind): void => {
    const open = useDoto.getState().tab
    if (!bounds || !open) return
    addModule({
      id: crypto.randomUUID(),
      kind,
      title: kind === 'todo' ? 'To-do' : 'Notes',
      color: 'default',
      pinned: false,
      rect: stackedWindowRect(bounds, open.modules.length),
      todos: [],
      content: null
    })
  }

  commandRef.current = (command) => {
    if (command === 'marker') useDoto.getState().toggleMarker()
    else if (command === 'eraser') useDoto.getState().setMarker({ tool: 'eraser' })
    else if (command === 'notes') openModule('notes')
    else openModule('todo')
  }

  const closeVideoDialog = (): void => {
    setVideoOpen(false)
    editor?.commands.focus()
  }

  const renameModule = (id: string, kind: ModuleKind, title: string): void => {
    const clean = title.trim().slice(0, 120) || (kind === 'todo' ? 'To-do' : 'Notes')
    updateModule(id, (current) => (current.title === clean ? current : { ...current, title: clean }))
  }

  return (
    <div className="app">
      <TopBar />
      <ConfirmDialog />
      <main className="canvas">
        <Notepad key={tabId} adjusting={adjusting} onEditorChange={setEditor} />
        <div className="module-layer" ref={setLayer}>
          {bounds &&
            modules.map((module) => (
              <ModuleWindow
                key={module.id}
                title={module.title}
                meta={module.kind === 'todo' ? <TodoMeta moduleId={module.id} /> : undefined}
                rect={module.rect}
                bounds={bounds}
                color={module.color}
                pinned={module.pinned}
                quietClose={!moduleHasInformation(module)}
                onChange={(rect) => updateModule(module.id, (current) => ({ ...current, rect }))}
                onRename={(title) => renameModule(module.id, module.kind, title)}
                onColor={(color: ModuleColor) => updateModule(module.id, (current) => (current.color === color ? current : { ...current, color }))}
                onTogglePin={() => updateModule(module.id, (current) => ({ ...current, pinned: !current.pinned }))}
                onClose={() => {
                  const snapshot = useDoto.getState().tab?.modules.find((item) => item.id === module.id)
                  if (!snapshot) return
                  const copy = structuredClone(snapshot)
                  void (async () => {
                    let trashId: string | null = null
                    if (moduleHasInformation(copy)) {
                      const before = useDoto.getState().archive.length
                      await useDoto.getState().trashModule(copy)
                      const archive = useDoto.getState().archive
                      trashId = archive.length > before ? (archive[0]?.id ?? null) : null
                    }
                    closedModule.current = { module: copy, trashId }
                    useDoto.getState().removeModule(copy.id)
                  })()
                }}
              >
                {module.kind === 'todo' ? <TodoModule moduleId={module.id} /> : <NotesModule moduleId={module.id} />}
              </ModuleWindow>
            ))}
        </div>
        {searchOpen && <SearchBar editor={focusedEditor ?? editor} onClose={() => setSearchOpen(false)} />}
      </main>
      <EraserCursor />
      <BottomBar
        editor={editor}
        adjusting={adjusting}
        searching={searchOpen}
        onToggleSearch={() => setSearchOpen((open) => !open)}
        onToggleFrame={() => setAdjusting((value) => !value)}
        onAddModule={openModule}
        onOpenVideo={() => {
          setVideoEditor(getActiveEditor() ?? editor)
          setVideoOpen(true)
        }}
      />
      {videoOpen && (
        <VideoDialog
          onCancel={closeVideoDialog}
          onEmbed={(videoId) => {
            setVideoOpen(false)
            const target = videoEditor && !videoEditor.isDestroyed ? videoEditor : editor
            if (target) insertVideo(target, videoId)
          }}
          onUpload={(src) => {
            setVideoOpen(false)
            const target = videoEditor && !videoEditor.isDestroyed ? videoEditor : editor
            if (target) insertLocalVideo(target, src)
          }}
        />
      )}
    </div>
  )
}

const EMPTY_MODULES: [] = []

function useElementSize(element: HTMLElement | null): Size | null {
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      const height = Math.floor(entry.contentRect.height)
      setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return size
}
