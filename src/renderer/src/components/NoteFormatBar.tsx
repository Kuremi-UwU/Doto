import { useEffect, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Eraser, Italic, Link2, List, ListOrdered, Table } from 'lucide-react'
import { FONT_FAMILIES, FONT_SIZES } from '../editor/extensions'
import { cx } from '../cx'

const STYLES = [
  { id: '1', label: 'Title', short: 'H1' },
  { id: '2', label: 'Subtitle', short: 'H2' },
  { id: '3', label: 'Heading', short: 'H3' },
  { id: '4', label: 'Subheading', short: 'H4' },
  { id: '5', label: 'Section', short: 'H5' },
  { id: '6', label: 'Subsection', short: 'H6' },
  { id: 'p', label: 'Body', short: 'Body' }
] as const

type MenuName = 'style' | 'list' | 'table' | 'link' | 'edit-table'

/** Compact formatting bar: headings, lists, and tables open as menus. */
export default function NoteFormatBar({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive('bold'),
            italic: editor.isActive('italic'),
            bullet: editor.isActive('bulletList'),
            ordered: editor.isActive('orderedList'),
            link: editor.isActive('link'),
            table: editor.isActive('table'),
            href: (editor.getAttributes('link').href as string | undefined) ?? '',
            family: (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? '',
            size: (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '',
            level: ([1, 2, 3, 4, 5, 6] as const).find((level) => editor.isActive('heading', { level })) ?? null,
            align: (editor.isActive('heading') ? editor.getAttributes('heading').textAlign : editor.getAttributes('paragraph').textAlign) || 'left'
          }
        : null
  })
  const [menu, setMenu] = useState<MenuName | null>(null)
  const [linkValue, setLinkValue] = useState('')
  const [grid, setGrid] = useState({ rows: 2, cols: 2 })

  useEffect(() => {
    if (!menu) return undefined
    const close = (event: PointerEvent): void => {
      if ((event.target as HTMLElement).closest('.format-pop')) return
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

  if (!editor || !active) return null

  const style = STYLES.find((entry) => entry.id === (active.level ? String(active.level) : 'p')) ?? STYLES[6]
  const toggle = (name: MenuName): void => setMenu((open) => (open === name ? null : name))
  const applyStyle = (id: string): void => {
    const chain = editor.chain().focus()
    if (id === 'p') chain.setParagraph().run()
    else chain.setHeading({ level: Number(id) as 1 | 2 | 3 | 4 | 5 | 6 }).run()
    setMenu(null)
  }
  const applyLink = (raw: string): void => {
    const text = raw.trim()
    if (!text) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
      if (editor.state.selection.empty) {
        editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
      }
    }
    setMenu(null)
  }

  return (
    <div className="format-bar">
      <div className="format-pop">
        <BarButton
          label="Link"
          active={active.link || menu === 'link'}
          onPress={() => {
            setLinkValue(active.href)
            toggle('link')
          }}
        >
          <Link2 size={15} />
        </BarButton>
        {menu === 'link' && (
          <form
            className="format-menu format-menu--link"
            onSubmit={(event) => {
              event.preventDefault()
              applyLink(linkValue)
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <input aria-label="Link address" placeholder="https://example.com" value={linkValue} autoFocus onChange={(event) => setLinkValue(event.target.value)} />
            <button type="submit" className="button button--small button--primary">
              Apply
            </button>
          </form>
        )}
      </div>
      <div className="format-pop">
        <BarButton label="Table" active={active.table || menu === 'table' || menu === 'edit-table'} onPress={() => toggle('table')}>
          <Table size={15} />
        </BarButton>
        {(menu === 'table' || menu === 'edit-table') && (
          <div className="format-menu" onMouseDown={(event) => event.preventDefault()}>
            <div className="format-menu__label">Insert table</div>
            <div className="table-grid" onMouseLeave={() => setGrid({ rows: 2, cols: 2 })}>
              {Array.from({ length: 6 }, (_, row) =>
                Array.from({ length: 6 }, (_, column) => (
                  <button
                    key={`${row}-${column}`}
                    type="button"
                    aria-label={`${row + 1} by ${column + 1} table`}
                    className={cx('table-grid__cell', row < grid.rows && column < grid.cols && 'is-hot')}
                    onMouseEnter={() => setGrid({ rows: row + 1, cols: column + 1 })}
                    onClick={() => {
                      editor.chain().focus().insertTable({ rows: row + 1, cols: column + 1, withHeaderRow: true }).run()
                      setMenu(null)
                    }}
                  />
                ))
              )}
            </div>
            <div className="format-menu__hint">
              {grid.rows} × {grid.cols}
            </div>
            <button
              type="button"
              className="format-menu__item"
              onClick={() => editor.chain().focus().insertTable({ rows: grid.rows, cols: grid.cols, withHeaderRow: true }).run()}
            >
              Insert table
            </button>
            <div className="format-pop format-pop--sub">
              <button type="button" className="format-menu__item" onClick={() => setMenu('edit-table')}>
                Edit table
                <ChevronDown size={14} className="format-menu__chevron" />
              </button>
              {menu === 'edit-table' && (
                <div className="format-menu format-menu--side">
                  <button type="button" className="format-menu__item" disabled={!active.table} onClick={() => editor.chain().focus().addRowAfter().run()}>
                    Add row
                  </button>
                  <button type="button" className="format-menu__item" disabled={!active.table} onClick={() => editor.chain().focus().addColumnAfter().run()}>
                    Add column
                  </button>
                  <button type="button" className="format-menu__item" disabled={!active.table} onClick={() => editor.chain().focus().deleteRow().run()}>
                    Delete row
                  </button>
                  <button type="button" className="format-menu__item" disabled={!active.table} onClick={() => editor.chain().focus().deleteColumn().run()}>
                    Delete column
                  </button>
                  <button type="button" className="format-menu__item" disabled={!active.table} onClick={() => editor.chain().focus().deleteTable().run()}>
                    Delete table
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <BarButton
        label="Clear formatting"
        onPress={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <Eraser size={15} />
      </BarButton>
      <span className="format-bar__gap" />
      <select
        className="format-bar__select"
        aria-label="Font"
        value={active.family}
        style={{ fontFamily: active.family || undefined }}
        onChange={(event) => {
          const value = event.target.value
          const chain = editor.chain().focus()
          if (value) chain.setFontFamily(value).run()
          else chain.unsetFontFamily().run()
        }}
      >
        {FONT_FAMILIES.map((entry) => (
          <option key={entry.label} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
      <select
        className="format-bar__select format-bar__select--size"
        aria-label="Font size"
        value={active.size}
        onChange={(event) => {
          const value = event.target.value
          const chain = editor.chain().focus()
          if (value) chain.setFontSize(value).run()
          else chain.unsetFontSize().run()
        }}
      >
        <option value="">Size</option>
        {FONT_SIZES.map((entry) => (
          <option key={entry} value={entry}>
            {entry.replace('px', '')}
          </option>
        ))}
      </select>
      <div className="format-pop">
        <button type="button" className={cx('format-bar__drop', menu === 'style' && 'is-open')} aria-haspopup="menu" onMouseDown={(event) => event.preventDefault()} onClick={() => toggle('style')}>
          {style.short}
          <ChevronDown size={14} />
        </button>
        {menu === 'style' && (
          <div className="format-menu format-menu--styles" role="menu" onMouseDown={(event) => event.preventDefault()}>
            {STYLES.map((entry) => (
              <button key={entry.id} type="button" role="menuitemradio" aria-checked={entry.id === style.id} className={cx('format-style', `format-style--${entry.id}`, entry.id === style.id && 'is-active')} onClick={() => applyStyle(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="format-pop">
        <button type="button" className={cx('format-bar__drop', (menu === 'list' || active.bullet || active.ordered) && 'is-open')} aria-label="Lists" aria-haspopup="menu" onMouseDown={(event) => event.preventDefault()} onClick={() => toggle('list')}>
          <List size={15} />
          <ChevronDown size={14} />
        </button>
        {menu === 'list' && (
          <div className="format-menu" role="menu" onMouseDown={(event) => event.preventDefault()}>
            <button type="button" className={cx('format-menu__item', active.bullet && 'is-active')} onClick={() => { editor.chain().focus().toggleBulletList().run(); setMenu(null) }}>
              <List size={15} /> Bulleted list
            </button>
            <button type="button" className={cx('format-menu__item', active.ordered && 'is-active')} onClick={() => { editor.chain().focus().toggleOrderedList().run(); setMenu(null) }}>
              <ListOrdered size={15} /> Numbered list
            </button>
            <div className="format-menu__rule" />
            <button type="button" className="format-menu__item" onClick={() => changeIndent(editor, 1)}>
              Increase indent
            </button>
            <button type="button" className="format-menu__item" onClick={() => changeIndent(editor, -1)}>
              Decrease indent
            </button>
          </div>
        )}
      </div>
      <span className="format-bar__gap" />
      <BarButton label="Align left" active={active.align === 'left'} onPress={() => alignText(editor, 'left')}>
        <AlignLeft size={15} />
      </BarButton>
      <BarButton label="Align center" active={active.align === 'center'} onPress={() => alignText(editor, 'center')}>
        <AlignCenter size={15} />
      </BarButton>
      <BarButton label="Align right" active={active.align === 'right'} onPress={() => alignText(editor, 'right')}>
        <AlignRight size={15} />
      </BarButton>
      <span className="format-bar__gap" />
      <BarButton label="Bold" active={active.bold} onPress={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={15} />
      </BarButton>
      <BarButton label="Italic" active={active.italic} onPress={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={15} />
      </BarButton>
    </div>
  )
}

const MAX_INDENT = 8

function changeIndent(editor: Editor, direction: 1 | -1): void {
  if (direction > 0 && editor.can().sinkListItem('listItem')) {
    editor.chain().focus().sinkListItem('listItem').run()
    return
  }
  if (direction < 0 && editor.can().liftListItem('listItem')) {
    editor.chain().focus().liftListItem('listItem').run()
    return
  }
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const { from, to } = state.selection
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
        const current = Number(node.attrs.indent) || 0
        const next = Math.min(MAX_INDENT, Math.max(0, current + direction))
        if (next === current) return
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next || null })
      })
      return true
    })
    .run()
}

function alignText(editor: Editor, alignment: 'left' | 'center' | 'right'): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const { from, to } = state.selection
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: alignment === 'left' ? null : alignment })
      })
      return true
    })
    .run()
}

function BarButton({
  label,
  active = false,
  disabled = false,
  onPress,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx('format-bar__button', active && 'is-active')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  )
}
