import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Clapperboard, Columns2, Eraser, Highlighter, ImagePlus, ListChecks, Mic, Pencil, Save, Search, StickyNote, Trash2 } from 'lucide-react'
import { moveDockItem } from '../../../shared/dock'
import type { DockItemId, DockSide, ModuleKind } from '../../../shared/types'
import { openTasksIn, wordsIn } from '../../../shared/stats'
import { cx } from '../cx'
import { useActiveEditor } from '../editor/active'
import { lastRecordingSeconds, toggleAudioRecording, useAudioLevels, useAudioRecording } from '../audioRecord'
import { insertImages, insertLocalAudio, replaceAudioSrc } from '../editor/extensions'
import { useDoto } from '../store'
import { askConfirm } from './ConfirmDialog'

const MARKER_COLORS = ['#1c1b19', '#d64545', '#3b6fe0', '#2f9d57', '#e0a31a', '#9b6adf']
const MARKER_SIZES = [2, 4, 8, 16]
const DRAG_TYPE = 'application/x-doto-dock'

interface BottomBarProps {
  editor: Editor | null
  adjusting: boolean
  searching: boolean
  onToggleSearch: () => void
  onToggleFrame: () => void
  onAddModule: (kind: ModuleKind) => void
  onOpenVideo: () => void
}

export default function BottomBar(props: BottomBarProps): React.JSX.Element {
  const dock = useDoto((state) => state.dock)
  const setDock = useDoto((state) => state.setDock)
  const marker = useDoto((state) => state.marker)

  const drop = (id: DockItemId, side: DockSide, index: number): void => {
    setDock(moveDockItem(useDoto.getState().dock, id, side, index))
  }

  return (
    <footer className="bottombar">
      <RecordingMeter />
      {marker.active && <MarkerOptions />}
      <DockZone side="left" ids={dock.left} onDrop={drop} {...props} />
      <DockZone side="center" ids={dock.center} onDrop={drop} {...props} />
      <div className="bottombar__side bottombar__side--end">
        <DockZone side="right" ids={dock.right} onDrop={drop} {...props} />
        <StatusReadout />
      </div>
    </footer>
  )
}

function DockZone({
  side,
  ids,
  onDrop,
  ...props
}: BottomBarProps & { side: DockSide; ids: DockItemId[]; onDrop: (id: DockItemId, side: DockSide, index: number) => void }): React.JSX.Element {
  return (
    <div
      className={cx('dock-zone', side === 'center' && 'dock', side === 'left' && 'bottombar__side')}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(DRAG_TYPE) as DockItemId
        if (!id) return
        event.preventDefault()
        onDrop(id, side, ids.length)
      }}
    >
      {ids.map((id, index) => (
        <DockButton key={id} id={id} compact={side !== 'center'} index={index} side={side} onDrop={onDrop} {...props} />
      ))}
    </div>
  )
}

function DockButton({
  id,
  compact,
  index,
  side,
  onDrop,
  editor,
  adjusting,
  searching,
  onToggleSearch,
  onToggleFrame,
  onAddModule,
  onOpenVideo
}: BottomBarProps & { id: DockItemId; compact: boolean; index: number; side: DockSide; onDrop: (id: DockItemId, side: DockSide, index: number) => void }): React.JSX.Element {
  const focused = useActiveEditor()
  const target = focused ?? editor
  const recording = useAudioRecording()
  const keybinds = useDoto((state) => state.keybinds)
  const markerOn = useDoto((state) => state.marker.active)
  const dragged = useRef(false)

  const run = (): void => {
    if (dragged.current) return
    if (id === 'save') void useDoto.getState().saveNow()
    else if (id === 'marker') useDoto.getState().toggleMarker()
    else if (id === 'search') onToggleSearch()
    else if (id === 'frame') onToggleFrame()
    else if (id === 'todo') onAddModule('todo')
    else if (id === 'notes') onAddModule('notes')
    else if (id === 'image') void addImages(target)
    else if (id === 'audio') void recordAudio(target)
    else onOpenVideo()
  }

  const disabled = (id === 'image' || id === 'video' || (id === 'audio' && !recording)) && !target
  const active = (id === 'search' && searching) || (id === 'frame' && adjusting) || (id === 'marker' && markerOn) || (id === 'audio' && recording)
  const iconOnly = id === 'audio'
  const label = LABELS[id]
  const shortcut =
    id === 'save' ? keybinds.save : id === 'search' ? keybinds.find : id === 'marker' ? keybinds.marker : id === 'notes' ? keybinds.notes : id === 'todo' ? keybinds.todo : ''
  const action = id === 'audio' && recording ? 'Recording. Click to stop and insert it.' : id === 'marker' && markerOn ? 'Marker is on. Click to stop drawing.' : shortcut ? `${label} (${shortcut}). Drag to move.` : `${label}. Drag to move.`

  return (
    <button
      type="button"
      draggable
      disabled={disabled}
      className={cx(compact ? 'frame-toggle' : 'dock-button', iconOnly && 'dock-button--icon', active && 'is-active', id === 'audio' && recording && 'is-recording')}
      title={action}
      onDragStart={(event) => {
        dragged.current = true
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(DRAG_TYPE, id)
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          dragged.current = false
        }, 0)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onDrop={(event) => {
        const moving = event.dataTransfer.getData(DRAG_TYPE) as DockItemId
        if (!moving) return
        event.preventDefault()
        event.stopPropagation()
        const before = event.clientX < event.currentTarget.getBoundingClientRect().left + event.currentTarget.offsetWidth / 2
        onDrop(moving, side, before ? index : index + 1)
      }}
      onClick={run}
    >
      <Icon id={id} />
      {!compact && !iconOnly && label}
    </button>
  )
}

function Icon({ id }: { id: DockItemId }): React.JSX.Element {
  if (id === 'save') return <Save size={18} />
  if (id === 'marker') return <Pencil size={18} />
  if (id === 'search') return <Search size={18} />
  if (id === 'frame') return <Columns2 size={18} />
  if (id === 'todo') return <ListChecks size={18} />
  if (id === 'notes') return <StickyNote size={18} />
  if (id === 'image') return <ImagePlus size={18} />
  if (id === 'audio') return <RecordFace />
  return <Clapperboard size={18} />
}

function RecordFace(): React.JSX.Element {
  return <Mic size={18} />
}

function RecordingMeter(): React.JSX.Element | null {
  const recording = useAudioRecording()
  const levels = useAudioLevels()
  if (!recording) return null
  return (
    <div className="record-meter" aria-hidden="true">
      <span className="record-wave">
        {levels.map((level, index) => (
          <span key={index} style={{ transform: `scaleY(${0.18 + level * 0.82})` }} />
        ))}
      </span>
    </div>
  )
}

const LABELS: Record<DockItemId, string> = {
  save: 'Save',
  marker: 'Marker',
  search: 'Search',
  frame: 'Frame',
  todo: 'To-do',
  notes: 'Notes',
  image: 'Image',
  video: 'Video',
  audio: 'Record'
}

async function recordAudio(target: Editor | null): Promise<void> {
  const tabId = useDoto.getState().tab?.id
  try {
    const clip = await toggleAudioRecording()
    if (!clip || clip.size === 0 || !target || target.isDestroyed || !tabId) return
    const preview = URL.createObjectURL(clip)
    insertLocalAudio(target, preview, lastRecordingSeconds())
    const src = await window.doto.saveAudio(tabId, new Uint8Array(await clip.arrayBuffer()))
    if (target.isDestroyed) {
      URL.revokeObjectURL(preview)
      return
    }
    replaceAudioSrc(target, preview, src)
    URL.revokeObjectURL(preview)
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : ''
    askConfirm({
      title: 'Microphone',
      message: `Doto couldn't use the Windows default microphone.${detail}`,
      confirmLabel: 'OK',
      run: () => undefined
    })
  }
}

async function addImages(target: Editor | null): Promise<void> {
  const tabId = useDoto.getState().tab?.id
  if (!target || !tabId) return
  const sources = await window.doto.pickImages(tabId)
  if (sources.length > 0 && !target.isDestroyed) insertImages(target, sources)
}

function MarkerOptions(): React.JSX.Element {
  const marker = useDoto((state) => state.marker)
  const setMarker = useDoto((state) => state.setMarker)
  const eraserKey = useDoto((state) => state.keybinds.eraser)
  return (
    <div className="marker-options" role="toolbar" aria-label="Marker">
      <button type="button" className={cx('marker-options__tool', marker.tool === 'pen' && 'is-active')} title="Pen" onClick={() => setMarker({ tool: 'pen' })}>
        <Pencil size={16} />
      </button>
      <button type="button" className={cx('marker-options__tool', marker.tool === 'highlighter' && 'is-active')} title="Highlighter" onClick={() => setMarker({ tool: 'highlighter' })}>
        <Highlighter size={16} />
      </button>
      <button type="button" className={cx('marker-options__tool', marker.tool === 'eraser' && 'is-active')} title={`Eraser (${eraserKey})`} onClick={() => setMarker({ tool: 'eraser' })}>
        <Eraser size={16} />
      </button>
      <span className="marker-options__gap" />
      {MARKER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={cx('marker-options__swatch', marker.color === color && marker.tool !== 'eraser' && 'is-active')}
          style={{ background: color }}
          aria-label={color}
          title={color}
          onClick={() => setMarker({ tool: marker.tool === 'eraser' ? 'pen' : marker.tool, color })}
        />
      ))}
      <span className="marker-options__gap" />
      {marker.tool === 'eraser' ? (
        <label className="marker-options__slider">
          <input
            type="range"
            min={2}
            max={100}
            value={marker.eraserSize}
            aria-label="Eraser size"
            onChange={(event) => setMarker({ eraserSize: Number(event.target.value) })}
          />
          <span>{marker.eraserSize}px</span>
        </label>
      ) : (
        MARKER_SIZES.map((size) => (
          <button key={size} type="button" className={cx('marker-options__size', marker.size === size && 'is-active')} title={`${size}px`} onClick={() => setMarker({ size })}>
            <span style={{ width: size + 2, height: size + 2 }} />
          </button>
        ))
      )}
      <span className="marker-options__gap" />
      <button
        type="button"
        className="marker-options__tool"
        title="Clear drawings"
        onClick={() =>
          askConfirm({
            title: 'Clear drawings?',
            message: 'Every pen, highlighter, and eraser mark on this tab is removed.',
            confirmLabel: 'Clear',
            run: () => useDoto.getState().setInk([])
          })
        }
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}

function StatusReadout(): React.JSX.Element {
  const saves = useDoto((state) => state.saves)
  const activeSaveId = useDoto((state) => state.activeSaveId)
  const tab = useDoto((state) => state.tab)
  const statusBar = useDoto((state) => state.statusBar)
  const save = saves.find((item) => item.id === activeSaveId)
  const tabs = (save?.tabs ?? []).map((summary) =>
    tab?.id === summary.id
      ? { id: summary.id, title: tab.title, openTasks: openTasksIn(tab.modules), words: wordsIn(tab.content), current: true }
      : { id: summary.id, title: summary.title, openTasks: summary.openTasks ?? 0, words: summary.words ?? 0, current: false }
  )
  const activeTasks = tabs.reduce((count, item) => count + item.openTasks, 0)
  const wordCount = tabs.reduce((count, item) => count + item.words, 0)
  return (
    <div className="status-readout" aria-live="polite">
      {statusBar.currentTab && (
        <span className="task-chip task-chip--active" title="Unfinished tasks on this tab">
          <span className="task-chip__count">{tabs.find((item) => item.current)?.openTasks ?? 0}</span>
          Active Tasks
        </span>
      )}
      {statusBar.saveTasks && <SaveTotal total={activeTasks} tabs={tabs} />}
      {statusBar.words && <span className="status-readout__words">{wordCount} words</span>}
    </div>
  )
}

function SaveTotal({ total, tabs }: { total: number; tabs: Array<{ id: string; title: string; openTasks: number; current: boolean }> }): React.JSX.Element {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const open = hovering || pinned

  useEffect(() => {
    if (!pinned) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setPinned(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinned(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <span className="status-pop" ref={ref} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
      <button type="button" className={cx('task-chip task-chip--total', pinned && 'is-open')} aria-expanded={open} title="Unfinished tasks in this save" onClick={() => setPinned((value) => !value)}>
        <span className="task-chip__count">{total}</span>
        Total Tasks
      </button>
      {open && (
        <div className="status-pop__menu" role="dialog" aria-label="Tasks by tab">
          <div className="status-pop__heading">By tab</div>
          {tabs.map((item) => (
            <div key={item.id} className={cx('status-pop__row', item.current && 'is-current')}>
              <span className="status-pop__name">{item.title}</span>
              <span className="status-pop__count">{item.openTasks}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
