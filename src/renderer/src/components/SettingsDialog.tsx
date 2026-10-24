import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'
import { acceleratorFromEvent } from '../../../shared/keys'
import { APP_VERSION, MADE_BY_LINE, MADE_BY_SITE } from '../../../shared/signature'
import { THEME_SWATCHES, type Keybinds, type StatusBarSettings, type Theme } from '../../../shared/types'
import { setRecordingShortcut } from '../keybindLock'
import { cx } from '../cx'
import { useDoto } from '../store'
import { askConfirm } from './ConfirmDialog'

type SettingsTab = 'general' | 'bottom' | 'keys'

export default function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-dialog__head">
          <h2 id="settings-title" className="dialog__title">
            Settings
          </h2>
          <button type="button" className="module-window__close" aria-label="Close settings" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="settings-nav" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'general'} className={cx('settings-nav__button', tab === 'general' && 'is-active')} onClick={() => setTab('general')}>
            General
          </button>
          <button type="button" role="tab" aria-selected={tab === 'bottom'} className={cx('settings-nav__button', tab === 'bottom' && 'is-active')} onClick={() => setTab('bottom')}>
            Bottom bar
          </button>
          <button type="button" role="tab" aria-selected={tab === 'keys'} className={cx('settings-nav__button', tab === 'keys' && 'is-active')} onClick={() => setTab('keys')}>
            Keybinds
          </button>
        </div>
        <div className="settings-dialog__body">{tab === 'general' ? <GeneralSettings onClose={onClose} /> : tab === 'bottom' ? <BottomBarSettings /> : <KeybindSettings />}</div>
      </div>
    </div>,
    document.body
  )
}

function GeneralSettings({ onClose }: { onClose: () => void }): React.JSX.Element {
  const theme = useDoto((state) => state.theme)
  const setTheme = useDoto((state) => state.setTheme)
  const autoSave = useDoto((state) => state.autoSave)
  const autoSaveMinutes = useDoto((state) => state.autoSaveMinutes)
  const setAutoSave = useDoto((state) => state.setAutoSave)
  const restoreBackup = useDoto((state) => state.restoreBackup)
  const dirty = useDoto((state) => state.dirty)
  const saveKey = useDoto((state) => state.keybinds.save)
  const exportDir = useDoto((state) => state.saves.find((save) => save.id === state.activeSaveId)?.exportDir ?? null)
  const chooseSaveFolder = useDoto((state) => state.chooseSaveFolder)
  const clearSaveFolder = useDoto((state) => state.clearSaveFolder)
  const [backups, setBackups] = useState<Array<{ slot: 1 | 2; savedAt: number; title: string }>>([])
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateNote, setUpdateNote] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    void window.doto.listBackups().then((listed) => {
      if (!cancel) setBackups(listed)
    })
    return () => {
      cancel = true
    }
  }, [exportDir])

  const checkUpdates = async (): Promise<void> => {
    setCheckingUpdate(true)
    setUpdateNote(null)
    try {
      const result = await window.doto.checkForUpdate()
      if (result.state === 'current') {
        setUpdateNote(`You're on the latest release (${result.version}).`)
        return
      }
      if (result.state === 'none') {
        setUpdateNote('No release published yet.')
        return
      }
      if (result.state === 'error') {
        setUpdateNote("Couldn't reach GitHub. Check your connection.")
        return
      }
      onClose()
      askConfirm({
        title: 'Update available',
        message: `Doto ${result.version} is available. Open the GitHub release to download it?`,
        confirmLabel: 'Open GitHub',
        run: () => {
          window.open(result.url)
        }
      })
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <>
      <section className="settings-card">
        <h3 className="settings-dialog__label">Theme</h3>
        <ThemePicker theme={theme} onChange={setTheme} />
      </section>
      <section className="settings-card">
      <h3 className="settings-dialog__label">Save file location</h3>
      <p className="settings-note">Only this save. Other saves keep their own folder. Notes are written as Word documents (.docx).</p>
      <p className="settings-path" title={exportDir ?? undefined}>
        {exportDir ?? 'No folder chosen yet.'}
      </p>
      <div className="backup-row">
        <button type="button" className="button button--small" onClick={() => void chooseSaveFolder()}>
          Choose folder
        </button>
        {exportDir && (
          <button type="button" className="button button--small" onClick={() => void clearSaveFolder()}>
            Clear
          </button>
        )}
      </div>
      </section>
      <section className="settings-card">
      <h3 className="settings-dialog__label">Saving</h3>
      <label className="settings-check">
        <input type="checkbox" checked={autoSave} onChange={(event) => setAutoSave(event.target.checked, autoSaveMinutes)} />
        Auto save
      </label>
      <label className="settings-minutes">
        Every
        <input
          type="number"
          min={1}
          max={180}
          aria-label="Auto save minutes"
          value={autoSaveMinutes}
          disabled={!autoSave}
          onChange={(event) => setAutoSave(true, Number(event.target.value))}
        />
        min
      </label>
      <p className="settings-note">{dirty && !autoSave ? `Unsaved changes. Press ${saveKey}.` : `${saveKey} saves now. Switching notes also writes them.`}</p>
      </section>
      <section className="settings-card">
      <h3 className="settings-dialog__label">Backups</h3>
      <p className="settings-note">The two latest copies of this save. Restore replaces the notes that are open now.</p>
      {backups.length === 0 ? (
        <p className="settings-note">No backups yet.</p>
      ) : (
        backups.map((backup) => (
          <div key={backup.slot} className="backup-row">
            <span>
              {backup.slot === 1 ? 'Latest' : 'Previous'}
              <span className="archive-item__meta">{new Date(backup.savedAt).toLocaleString()}</span>
            </span>
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                onClose()
                askConfirm({
                  title: 'Restore this backup?',
                  message: `${backup.title} from ${new Date(backup.savedAt).toLocaleString()} replaces the current notes in this save.`,
                  confirmLabel: 'Restore',
                  run: () => void restoreBackup(backup.slot)
                })
              }}
            >
              Restore
            </button>
          </div>
        ))
      )}
      </section>
      <section className="settings-card settings-card--about">
        <div>
          <h3 className="settings-dialog__label">About</h3>
          <p className="about-credit">{MADE_BY_LINE}</p>
          <p className="settings-note">Version {APP_VERSION}</p>
          <a className="settings-link" href={MADE_BY_SITE} target="_blank" rel="noreferrer">
            www.kuremi.in
          </a>
          <div className="about-update">
            <button type="button" className="button button--small" disabled={checkingUpdate} onClick={() => void checkUpdates()}>
              {checkingUpdate ? 'Checking…' : 'Check for updates'}
            </button>
            {updateNote && <p className="settings-note">{updateNote}</p>}
          </div>
        </div>
        <img className="about-logo" src="logo.png" alt="Doto" />
      </section>
    </>
  )
}

/** Light and Dark are neutral themes, so the bar uses their paper color. A pastel pair shares one hue: Light is the accent, Dark is that same color deepened. */
function themeBarStyle(value: Theme): React.CSSProperties {
  const option = THEME_SWATCHES[value]
  if (value === 'light' || value === 'dark') {
    return { backgroundColor: option.ground, color: option.text, borderColor: option.border }
  }
  const accent = value.endsWith('-dark') ? THEME_SWATCHES[value.replace(/-dark$/, '-light') as Theme].accent : option.accent
  const background = value.endsWith('-dark') ? shade(accent, 0.62) : accent
  return { backgroundColor: background, color: '#ffffff', borderColor: background }
}

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const channel = (start: number): string =>
    Math.round(Number.parseInt(value.slice(start, start + 2), 16) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = THEME_SWATCHES[theme]

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="theme-picker" ref={root}>
      <button
        type="button"
        className="theme-picker__bar"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={themeBarStyle(theme)}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-picker__name">{current.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="theme-picker__menu" role="listbox" aria-label="Theme">
          {(Object.keys(THEME_SWATCHES) as Theme[]).map((value) => {
            const option = THEME_SWATCHES[value]
            const selected = value === theme
            return (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={selected}
                className={cx('theme-picker__option', selected && 'is-active')}
                style={themeBarStyle(value)}
                onClick={() => {
                  onChange(value)
                  setOpen(false)
                }}
              >
                <span className="theme-picker__name">{option.label}</span>
                {selected && <Check size={16} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BottomBarSettings(): React.JSX.Element {
  const statusBar = useDoto((state) => state.statusBar)
  const setStatusBar = useDoto((state) => state.setStatusBar)
  const toggle = (key: keyof StatusBarSettings): void => setStatusBar({ ...statusBar, [key]: !statusBar[key] })

  return (
    <section className="settings-card">
      <h3 className="settings-dialog__label">Bottom right</h3>
      <p className="settings-note">Choose what the bottom-right of the bar shows for the save you have open.</p>
      <label className="settings-check">
        <input type="checkbox" checked={statusBar.currentTab} onChange={() => toggle('currentTab')} />
        Active Tasks on this tab
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={statusBar.saveTasks} onChange={() => toggle('saveTasks')} />
        Total Tasks in this save
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={statusBar.words} onChange={() => toggle('words')} />
        Total word count
      </label>
    </section>
  )
}

function KeybindSettings(): React.JSX.Element {
  const keybinds = useDoto((state) => state.keybinds)
  const setKeybinds = useDoto((state) => state.setKeybinds)
  const [clash, setClash] = useState('')
  const change = (key: keyof Keybinds, value: string): void => {
    const taken = (Object.keys(keybinds) as (keyof Keybinds)[]).some((name) => name !== key && keybinds[name] === value)
    if (taken) {
      setClash(`${value} is already used. Pick a different shortcut.`)
      return
    }
    setClash('')
    setKeybinds({ ...keybinds, [key]: value })
  }
  return (
    <section className="settings-card">
      <h3 className="settings-dialog__label">Shortcuts</h3>
      <p className="settings-note">Click a shortcut, then press the keys you want. Escape cancels. A shortcut needs Ctrl, Alt, or Shift, and each one has to be different.</p>
      <KeybindRow label="Save" value={keybinds.save} onChange={(value) => change('save', value)} />
      <KeybindRow label="Find" value={keybinds.find} onChange={(value) => change('find', value)} />
      <KeybindRow label="Marker" value={keybinds.marker} onChange={(value) => change('marker', value)} />
      <KeybindRow label="New notes" value={keybinds.notes} onChange={(value) => change('notes', value)} />
      <KeybindRow label="New to-do" value={keybinds.todo} onChange={(value) => change('todo', value)} />
      <KeybindRow label="Eraser" value={keybinds.eraser} onChange={(value) => change('eraser', value)} />
      {clash && <p className="settings-note settings-note--warn">{clash}</p>}
    </section>
  )
}

function KeybindRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!recording) return undefined
    setRecordingShortcut(true)
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const next = acceleratorFromEvent(event)
      if (!next) return
      onChangeRef.current(next)
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      setRecordingShortcut(false)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [recording])

  return (
    <div className="keybind-row">
      <span>{label}</span>
      <button type="button" className={cx('keybind-row__button', recording && 'is-recording')} onClick={() => setRecording(true)}>
        {recording ? 'Press a shortcut' : value}
      </button>
    </div>
  )
}
