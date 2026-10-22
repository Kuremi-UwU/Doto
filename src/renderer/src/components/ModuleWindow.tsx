import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Rnd } from 'react-rnd'
import { Pin, X } from 'lucide-react'
import { MODULE_COLORS, type ModuleColor, type ModuleRect } from '../../../shared/types'
import { cx } from '../cx'
import { askConfirm } from './ConfirmDialog'
import InlineInput from './InlineInput'

export interface Size {
  width: number
  height: number
}

const SNAP_DISTANCE = 12
const EDGE_GAP = 20
const MIN_WIDTH = 260
const MIN_HEIGHT = 220
const DEFAULT_SIZE: Size = { width: 340, height: 460 }
const LOCKED_RESIZE = {
  top: false,
  right: false,
  bottom: false,
  left: false,
  topRight: false,
  bottomRight: false,
  bottomLeft: false,
  topLeft: false
}
const COLOR_LABELS: Record<ModuleColor, string> = {
  default: 'Default',
  sand: 'Sand',
  blue: 'Blue',
  green: 'Green',
  rose: 'Rose',
  amber: 'Amber',
  violet: 'Violet'
}

interface ModuleWindowProps {
  title: string
  meta?: ReactNode
  rect: ModuleRect
  bounds: Size
  color: ModuleColor
  pinned: boolean
  onChange: (rect: ModuleRect) => void
  onRename: (title: string) => void
  onColor: (color: ModuleColor) => void
  onTogglePin: () => void
  onClose: () => void
  /** An empty notes or to-do window closes without a confirmation. */
  quietClose?: boolean
  children: ReactNode
}

let stack = 1

/** A floating window that lives inside the canvas: drag it by the title bar, resize it from any edge. */
export default function ModuleWindow({
  title,
  meta,
  rect,
  bounds,
  color,
  pinned,
  onChange,
  onRename,
  onColor,
  onTogglePin,
  onClose,
  quietClose = false,
  children
}: ModuleWindowProps): React.JSX.Element {
  const view = clampRect(rect, bounds)
  const [zIndex, setZIndex] = useState(() => ++stack)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const raise = (): void => setZIndex(++stack)
  const commit = (next: ModuleRect): void => {
    if (next.x !== rect.x || next.y !== rect.y || next.width !== rect.width || next.height !== rect.height) onChange(next)
  }

  useEffect(() => {
    if (!menu) return undefined
    const close = (event: PointerEvent): void => {
      if ((event.target as HTMLElement).closest('.module-menu')) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <Rnd
      className={cx('module-window', pinned && 'is-locked')}
      style={{ zIndex }}
      bounds="parent"
      disableDragging={pinned}
      enableResizing={pinned ? LOCKED_RESIZE : undefined}
      dragHandleClassName="module-window__bar"
      cancel=".module-window__close, .module-window__pin, .module-window__name"
      minWidth={Math.min(MIN_WIDTH, bounds.width)}
      minHeight={Math.min(MIN_HEIGHT, bounds.height)}
      position={{ x: view.x, y: view.y }}
      size={{ width: view.width, height: view.height }}
      resizeHandleClasses={{ bottomRight: 'module-window__grip' }}
      onMouseDown={raise}
      onDragStart={() => {
        raise()
        startArranging()
      }}
      onDragStop={(_event, data) => {
        stopArranging()
        commit(snapRect({ ...view, x: data.x, y: data.y }, bounds, 'move'))
      }}
      onResizeStart={() => {
        raise()
        startArranging()
      }}
      onResizeStop={(_event, _direction, element, _delta, position) => {
        stopArranging()
        commit(snapRect({ ...view, ...position, width: element.offsetWidth, height: element.offsetHeight }, bounds, 'resize'))
      }}
    >
      <section
        className="module-window__frame"
        data-color={color}
        onContextMenu={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('input, textarea, [contenteditable="true"]')) return
          event.preventDefault()
          setMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 64) })
        }}
      >
        <header className="module-window__bar">
          {editing ? (
            <InlineInput
              className="module-window__rename"
              ariaLabel="Window name"
              initialValue={title}
              maxLength={120}
              onCommit={(value) => {
                onRename(value)
                setEditing(false)
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <h2 className="module-window__title">
              <span className="module-window__name" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
                {title}
              </span>
              {meta}
            </h2>
          )}
          <button
            type="button"
            className={cx('module-window__pin', pinned && 'is-pinned')}
            aria-pressed={pinned}
            aria-label={pinned ? 'Unlock window' : 'Lock window in place'}
            title={pinned ? 'Unlock window' : 'Lock window in place'}
            onClick={onTogglePin}
          >
            <Pin size={14} />
          </button>
          <button
            type="button"
            className="module-window__close"
            aria-label="Close"
            title="Close"
            onClick={() => {
              if (quietClose) {
                onClose()
                return
              }
              askConfirm({
                title: `Close ${title}?`,
                message: 'This window and everything in it are removed.',
                confirmLabel: 'Close',
                run: onClose
              })
            }}
          >
            <X size={15} />
          </button>
        </header>
        <div className="module-window__body">{children}</div>
      </section>
      {menu &&
        createPortal(
          <div className="menu module-menu" role="menu" aria-label="Window" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setMenu(null)
                setEditing(true)
              }}
            >
              <span className="menu__label">Rename</span>
            </button>
            <div className="menu__heading">Color</div>
            <div className="color-menu">
            {MODULE_COLORS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="menuitemradio"
                aria-checked={entry === color}
                aria-label={COLOR_LABELS[entry]}
                title={COLOR_LABELS[entry]}
                className={cx('color-swatch', `color-swatch--${entry}`, entry === color && 'is-active')}
                onClick={() => {
                  onColor(entry)
                  setMenu(null)
                }}
              />
            ))}
            </div>
          </div>,
          document.body
        )}
    </Rnd>
  )
}

/** Where the first module window opens: the top-right corner of the canvas. */
export function defaultWindowRect(bounds: Size): ModuleRect {
  const width = DEFAULT_SIZE.width
  const height = Math.min(DEFAULT_SIZE.height, bounds.height - EDGE_GAP * 2)
  return clampRect({ width, height, x: bounds.width - width - EDGE_GAP, y: EDGE_GAP }, bounds)
}

/** Later windows step down-left so a new to-do does not cover the previous one. */
export function stackedWindowRect(bounds: Size, index: number): ModuleRect {
  const base = defaultWindowRect(bounds)
  const shift = (index % 8) * 26
  return clampRect({ ...base, x: base.x - shift, y: base.y + shift }, bounds)
}

function clampRect(rect: ModuleRect, bounds: Size): ModuleRect {
  const width = Math.round(Math.min(Math.max(rect.width, MIN_WIDTH), bounds.width))
  const height = Math.round(Math.min(Math.max(rect.height, MIN_HEIGHT), bounds.height))
  const x = Math.round(Math.min(Math.max(rect.x, 0), bounds.width - width))
  const y = Math.round(Math.min(Math.max(rect.y, 0), bounds.height - height))
  return { x, y, width, height }
}

/** Pulls any edge that ends up within SNAP_DISTANCE of the canvas edge flush against it. */
function snapRect(rect: ModuleRect, bounds: Size, mode: 'move' | 'resize'): ModuleRect {
  let { x, y, width, height } = rect
  const nearRight = bounds.width - (x + width) < SNAP_DISTANCE
  const nearBottom = bounds.height - (y + height) < SNAP_DISTANCE

  if (mode === 'move') {
    if (x < SNAP_DISTANCE) x = 0
    else if (nearRight) x = bounds.width - width
    if (y < SNAP_DISTANCE) y = 0
    else if (nearBottom) y = bounds.height - height
  } else {
    if (nearRight) width = bounds.width - x
    if (nearBottom) height = bounds.height - y
    if (x < SNAP_DISTANCE) {
      width += x
      x = 0
    }
    if (y < SNAP_DISTANCE) {
      height += y
      y = 0
    }
  }
  return clampRect({ x, y, width, height }, bounds)
}

function startArranging(): void {
  document.body.classList.add('is-arranging')
}

function stopArranging(): void {
  document.body.classList.remove('is-arranging')
}
