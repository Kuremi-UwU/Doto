import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { TextFrame } from '../../../shared/types'
import { cx } from '../cx'
import { clearEditor, focusEditor } from '../editor/active'
import { armScrollbarDrag, isDraggingScrollbar, isScrollbarHit } from '../editor/scrollbar'
import { createExtensions, withMediaIds } from '../editor/extensions'
import { notesMatch, registerEditorSnapshot, registerPageContent } from '../editor/snapshot'
import InkLayer from './InkLayer'
import AttachmentPins from './AttachmentPins'
import MediaInk from './MediaInk'
import { useDoto } from '../store'
import NoteFormatBar from './NoteFormatBar'

const MIN_COLUMN = 280

interface NotepadProps {
  adjusting: boolean
  onEditorChange: (editor: Editor | null) => void
}

export default function Notepad({ adjusting, onEditorChange }: NotepadProps): React.JSX.Element {
  const savedFrame = useDoto((state) => state.tab?.textFrame ?? null)
  const setTextFrame = useDoto((state) => state.setTextFrame)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const [bounds, setBounds] = useState(0)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const editor = useEditor({
    extensions: createExtensions('Start writing…'),
    content: withMediaIds(useDoto.getState().tab?.content ?? null),
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'note', spellcheck: 'true' },
      handleScrollToSelection: () => isDraggingScrollbar(),
      handleDOMEvents: {
        focus: () => {
          if (editorRef.current) focusEditor(editorRef.current)
          return false
        },
        mousedown: (_view, event) => {
          const scroller = (event.target as HTMLElement | null)?.closest('.note-scroll')
          if (!(scroller instanceof HTMLElement) || !isScrollbarHit(scroller, event)) return false
          armScrollbarDrag(scroller, event)
          return true
        }
      }
    },
    onUpdate: ({ editor }) => useDoto.getState().setContent(editor.getJSON())
  })

  editorRef.current = editor

  useEffect(() => {
    if (!editor) return undefined
    return registerPageContent((content) => {
      if (editor.isDestroyed) return
      const next = withMediaIds(content)
      if (!next || notesMatch(next, editor.getJSON())) return
      editor.commands.setContent(next, { emitUpdate: false })
    })
  }, [editor])

  useEffect(() => {
    if (!editor) return undefined
    return registerEditorSnapshot(() => {
      if (editor.isDestroyed) return
      const content = editor.getJSON()
      if (!notesMatch(useDoto.getState().tab?.content, content)) useDoto.getState().setContent(content)
    })
  }, [editor])

  useEffect(() => {
    onEditorChange(editor)
    if (editor) focusEditor(editor)
    return () => {
      if (editor) clearEditor(editor)
      onEditorChange(null)
    }
  }, [editor, onEditorChange])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setBounds(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const frame = fitFrame(savedFrame ?? defaultFrame(bounds || 800), bounds || 800)

  const dragFrame = (edge: 'left' | 'right', event: React.PointerEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const start = frame
    const limit = bounds || 800
    const move = (pointer: PointerEvent): void => {
      const dx = pointer.clientX - startX
      const next =
        edge === 'left'
          ? { x: start.x + dx, width: start.width - dx }
          : { x: start.x, width: start.width + dx }
      setTextFrame(fitFrame(next, limit))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div
      className="note-scroll"
      ref={scrollRef}
      onMouseDown={(event) => {
        if (isScrollbarHit(event.currentTarget, event)) {
          armScrollbarDrag(event.currentTarget, event)
          return
        }
        if (event.target === event.currentTarget) editor?.commands.focus('end')
      }}
    >
      <div className="note-sheet">
        <InkLayer surface="note" />
        <div className={cx('note-column', adjusting && 'is-adjusting')} style={{ marginLeft: frame.x, width: frame.width }}>
          {adjusting && (
            <span className="frame-handle frame-handle--left" title="Drag to move the text frame" onPointerDown={(event) => dragFrame('left', event)} />
          )}
          <NoteFormatBar editor={editor} />
          <div className="note-stage" ref={setStage}>
            <EditorContent editor={editor} className="note-frame" />
            <InkLayer surface="note-frame" />
            <MediaInk root={stage} surface="note-frame" />
            <AttachmentPins root={stage} editor={editor} />
          </div>
          {adjusting && (
            <span className="frame-handle frame-handle--right" title="Drag to resize the text frame" onPointerDown={(event) => dragFrame('right', event)} />
          )}
        </div>
      </div>
    </div>
  )
}

function defaultFrame(bounds: number): TextFrame {
  const width = Math.min(720, Math.max(MIN_COLUMN, bounds - 96))
  return { x: Math.max(24, Math.round((bounds - width) / 2)), width }
}

function fitFrame(frame: TextFrame, bounds: number): TextFrame {
  const width = Math.round(Math.min(Math.max(frame.width, MIN_COLUMN), Math.max(MIN_COLUMN, bounds - 32)))
  const x = Math.round(Math.min(Math.max(frame.x, 12), Math.max(12, bounds - width - 12)))
  return { x, width }
}

