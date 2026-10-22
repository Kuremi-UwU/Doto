import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Folder, Plus, Settings, Trash, X } from 'lucide-react'
import { ARCHIVE_DAYS, MODULE_COLORS, type ModuleColor } from '../../../shared/types'
import { tabHasInformation } from '../../../shared/stats'
import { cx } from '../cx'
import { useDoto } from '../store'
import { askConfirm } from './ConfirmDialog'
import InlineInput from './InlineInput'
import SettingsDialog from './SettingsDialog'

const DAY_MS = 24 * 60 * 60 * 1000

export default function TopBar(): React.JSX.Element {
  return (
    <header className="topbar">
      <SaveSwitcher />
      <TabStrip />
      <div className="topbar__section">
        <SaveWarning />
        <ArchiveButton />
        <SettingsButton />
      </div>
    </header>
  )
}

function usePopover(): { open: boolean; ref: React.RefObject<HTMLDivElement | null>; toggle: () => void; close: () => void } {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((value) => !value), [])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [open, close])

  return { open, ref, toggle, close }
}

function SaveSwitcher(): React.JSX.Element {
  const saves = useDoto((state) => state.saves)
  const activeSaveId = useDoto((state) => state.activeSaveId)
  const openSave = useDoto((state) => state.openSave)
  const createSave = useDoto((state) => state.createSave)
  const deleteSave = useDoto((state) => state.deleteSave)
  const renameSave = useDoto((state) => state.renameSave)
  const popover = usePopover()
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const save = saves.find((entry) => entry.id === activeSaveId) ?? saves[0]
  const recent = useMemo(() => [...saves].sort((a, b) => b.updatedAt - a.updatedAt), [saves])

  useEffect(() => {
    if (!menu) return undefined
    const close = (): void => setMenu(false)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!save) return <span />

  if (editing) {
    return (
      <InlineInput
        className="save-name save-name--editing"
        ariaLabel="Save name"
        initialValue={save.title}
        maxLength={120}
        onCommit={(value) => {
          renameSave(value)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="popover-anchor" ref={popover.ref}>
      <button
        type="button"
        className={cx('topbar__button save-name', popover.open && 'is-open')}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        title="Saves. Right-click to rename or delete."
        onClick={popover.toggle}
        onContextMenu={(event) => {
          event.preventDefault()
          popover.close()
          setMenu(true)
        }}
      >
        <Folder size={16} />
        <span>{save.title}</span>
        <ChevronDown size={14} />
      </button>
      {menu && (
        <div className="menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setMenu(false)
              setEditing(true)
            }}
          >
            <span className="menu__label">Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item menu__item--danger"
            onClick={() => {
              setMenu(false)
              askConfirm({
                title: `Delete ${save.title}?`,
                message: `Notes with something in them go to the trash for ${ARCHIVE_DAYS} days. Empty notes are removed.`,
                confirmLabel: 'Delete save',
                run: () => void deleteSave(save.id)
              })
            }}
          >
            <span className="menu__label">Delete</span>
          </button>
        </div>
      )}
      {popover.open && (
        <div className="menu" role="menu">
          <div className="menu__heading">Recent saves</div>
          <div className="menu__scroll">
            {recent.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitemradio"
                aria-checked={entry.id === save.id}
                className={cx('menu__item', entry.id === save.id && 'is-active')}
                onClick={() => {
                  popover.close()
                  void openSave(entry.id)
                }}
              >
                <span className="menu__label">{entry.title}</span>
                {entry.id === save.id && <Check size={14} />}
              </button>
            ))}
          </div>
          <div className="menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              popover.close()
              void createSave()
            }}
          >
            <Plus size={14} />
            <span className="menu__label">New save</span>
          </button>
        </div>
      )}
    </div>
  )
}

function TabStrip(): React.JSX.Element {
  const saves = useDoto((state) => state.saves)
  const activeSaveId = useDoto((state) => state.activeSaveId)
  const activeTabId = useDoto((state) => state.tab?.id)
  const openTab = useDoto((state) => state.openTab)
  const createTab = useDoto((state) => state.createTab)
  const reorderTabs = useDoto((state) => state.reorderTabs)
  const save = saves.find((entry) => entry.id === activeSaveId)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)

  const move = (to: number): void => {
    if (!save || !dragId) return
    const ids = save.tabs.map((tab) => tab.id)
    const from = ids.indexOf(dragId)
    if (from === -1) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to > from ? to - 1 : to, 0, moved)
    setDragId(null)
    setOver(null)
    if (next.some((id, index) => id !== ids[index])) reorderTabs(next)
  }

  return (
    <div
      className="tabstrip"
      role="tablist"
      aria-label="Tabs"
      onDragOver={(event) => {
        if (dragId) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (over !== null) move(over)
      }}
    >
      {save?.tabs.map((tab, index) => (
        <NoteTab
          key={tab.id}
          id={tab.id}
          title={tab.title}
          color={tab.color ?? 'default'}
          active={tab.id === activeTabId}
          dragging={dragId === tab.id}
          dropBefore={dragId !== null && over === index}
          dropAfter={dragId !== null && over === save.tabs.length && index === save.tabs.length - 1}
          onOpen={() => void openTab(tab.id)}
          onDragStart={() => setDragId(tab.id)}
          onDragEnd={() => {
            setDragId(null)
            setOver(null)
          }}
          onDragOver={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setOver(event.clientX < box.left + box.width / 2 ? index : index + 1)
          }}
        />
      ))}
      <button type="button" className="tab-new" aria-label="New tab" title="New tab" onClick={() => void createTab()}>
        <Plus size={16} />
      </button>
    </div>
  )
}

function NoteTab({
  id,
  title,
  color,
  active,
  dragging,
  dropBefore,
  dropAfter,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver
}: {
  id: string
  title: string
  color: ModuleColor
  active: boolean
  dragging: boolean
  dropBefore: boolean
  dropAfter: boolean
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  const renameTab = useDoto((state) => state.renameTab)
  const archiveTab = useDoto((state) => state.archiveTab)
  const archive = (): void => {
    void (async () => {
      try {
        await useDoto.getState().flush()
        const live = useDoto.getState().tab
        const snapshot = live?.id === id ? live : await window.doto.readTab(id)
        if (!tabHasInformation(snapshot)) {
          await archiveTab(id)
          return
        }
      } catch {
        // The save still drops a blank note instead of putting it in the trash.
      }
      askConfirm({
        title: 'Archive this tab?',
        message: `${title} moves to the archive for 7 days. You can restore it from there.`,
        confirmLabel: 'Archive',
        run: () => void archiveTab(id)
      })
    })()
  }
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!menu) return undefined
    const close = (): void => setMenu(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  if (editing && active) {
    return (
      <InlineInput
        className="tab tab--editing"
        ariaLabel="Tab name"
        initialValue={title}
        maxLength={120}
        onCommit={(value) => {
          renameTab(value)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div
      className={cx('tab', active && 'is-active', menu && 'is-open', dragging && 'is-dragging', dropBefore && 'drop-before', dropAfter && 'drop-after')}
      data-color={color}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver(event)
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="tab__label"
        title="Drag to rearrange"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-doto-tab', id)
          onDragStart()
        }}
        onClick={onOpen}
        onDoubleClick={() => {
          if (active) setEditing(true)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpen()
          setMenu(true)
        }}
      >
        {title}
      </button>
      <button
        type="button"
        className="tab__close"
        aria-label={`Archive ${title}`}
        title="Move to archive"
        onClick={archive}
      >
        <X size={13} />
      </button>
      {menu && (
        <div className="menu tab__menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setMenu(false)
              setEditing(true)
            }}
          >
            <span className="menu__label">Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setMenu(false)
              archive()
            }}
          >
            <span className="menu__label">Move to archive</span>
          </button>
          <div className="menu__heading">Color</div>
          <div className="color-menu">
            {MODULE_COLORS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="menuitemradio"
                aria-checked={entry === color}
                aria-label={entry}
                title={entry}
                className={cx('color-swatch', `color-swatch--${entry}`, entry === color && 'is-active')}
                onClick={() => {
                  useDoto.getState().setTabColor(id, entry)
                  setMenu(false)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function notePreview(entry: { content: unknown; modules: Array<{ content: unknown; todos: Array<{ text: string }> }> }): string {
  const fromTodos = entry.modules.flatMap((module) => module.todos.map((todo) => todo.text)).filter(Boolean).join(', ')
  const text = plainText(entry.content) || entry.modules.map((module) => plainText(module.content)).find(Boolean) || fromTodos
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function plainText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if ('text' in value && typeof value.text === 'string') return value.text
  if ('content' in value && Array.isArray(value.content)) return value.content.map((item) => plainText(item)).join(' ')
  return ''
}

function SaveWarning(): React.JSX.Element | null {
  const saveFailed = useDoto((state) => state.saveFailed)
  const savedAt = useDoto((state) => state.savedAt)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (!savedAt) return undefined
    setShowSaved(true)
    const timer = setTimeout(() => setShowSaved(false), 1400)
    return () => clearTimeout(timer)
  }, [savedAt])

  if (saveFailed) {
    return (
      <span className="save-warning" role="status">
        <CircleAlert size={14} />
        Not saved, retrying
      </span>
    )
  }
  if (!showSaved) return null
  return (
    <span className="save-status" role="status">
      <Check size={14} />
      Saved
    </span>
  )
}

function ArchiveButton(): React.JSX.Element {
  const archive = useDoto((state) => state.archive)
  const restoreArchived = useDoto((state) => state.restoreArchived)
  const deleteArchived = useDoto((state) => state.deleteArchived)
  const popover = usePopover()

  return (
    <div className="popover-anchor" ref={popover.ref}>
      <button
        type="button"
        className={cx('icon-button', popover.open && 'is-open')}
        title="Trash"
        aria-label="Trash"
        aria-expanded={popover.open}
        onClick={popover.toggle}
      >
        <Trash size={16} />
        {archive.length > 0 && <span className="icon-button__count">{archive.length}</span>}
      </button>
      {popover.open && (
        <div className="menu menu--end archive-menu" role="dialog" aria-label="Trash">
          <div className="menu__heading">Trash</div>
          <p className="archive-menu__hint">
            Notes and to-do windows with something in them, and tabs that are not empty, stay here for {ARCHIVE_DAYS} days.
          </p>
          {archive.length > 0 && (
            <div className="archive-menu__toolbar">
              <button
                type="button"
                className="button button--small button--danger"
                onClick={() => {
                  popover.close()
                  askConfirm({
                    title: 'Clean all trash?',
                    message: `All ${archive.length} items will be removed for good.`,
                    confirmLabel: 'Clean all',
                    run: () => void useDoto.getState().emptyTrash()
                  })
                }}
              >
                Clean all
              </button>
            </div>
          )}
          {archive.length === 0 ? (
            <p className="archive-menu__empty">The trash is empty.</p>
          ) : (
            <div className="menu__scroll">
              {archive.map((entry) => {
                const days = Math.max(0, Math.ceil((entry.archivedAt + ARCHIVE_DAYS * DAY_MS - Date.now()) / DAY_MS))
                return (
                  <div key={entry.id} className="archive-item">
                    <div className="archive-item__text">
                      <span className="archive-item__title">{entry.title}</span>
                      {notePreview(entry) && <span className="archive-item__preview">{notePreview(entry)}</span>}
                      <span className="archive-item__meta">
                        {entry.kind === 'todo' ? 'To-do' : entry.kind === 'notes' ? 'Notes' : entry.saveTitle} ·{' '}
                        {days === 0 ? 'Deletes today' : days === 1 ? '1 day left' : `${days} days left`}
                      </span>
                    </div>
                    <div className="archive-item__actions">
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => {
                          popover.close()
                          void restoreArchived(entry.id)
                        }}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="button button--small button--danger"
                        onClick={() => {
                          popover.close()
                          askConfirm({
                            title: 'Delete this note?',
                            message: `${entry.title} will be removed for good.`,
                            confirmLabel: 'Delete',
                            run: () => void deleteArchived(entry.id)
                          })
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SettingsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={cx('icon-button', open && 'is-open')} title="Settings" aria-label="Settings" aria-expanded={open} onClick={() => setOpen(true)}>
        <Settings size={17} />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  )
}
