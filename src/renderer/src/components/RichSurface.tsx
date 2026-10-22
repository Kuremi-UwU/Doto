import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { focusEditor, clearEditor } from '../editor/active'
import { createExtensions, withMediaIds } from '../editor/extensions'
import { armScrollbarDrag, isDraggingScrollbar, isScrollbarHit } from '../editor/scrollbar'
import { notesMatch, registerEditorSnapshot } from '../editor/snapshot'
import InkLayer from './InkLayer'
import AttachmentPins from './AttachmentPins'
import MediaInk from './MediaInk'
import { useDoto } from '../store'

interface RichSurfaceProps {
  moduleId: string
  placeholder: string
}

/** A TipTap surface inside a module, so images and videos land in that window. */
export default function RichSurface({ moduleId, placeholder }: RichSurfaceProps): React.JSX.Element {
  const updateModule = useDoto((state) => state.updateModule)
  const pinned = useDoto((state) => state.tab?.modules.find((module) => module.id === moduleId)?.pinned ?? false)
  const editorRef = useRef<Editor | null>(null)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const editor = useEditor({
    extensions: createExtensions(placeholder),
    content: withMediaIds(useDoto.getState().tab?.modules.find((module) => module.id === moduleId)?.content ?? null),
    editorProps: {
      attributes: { class: 'note note--module', spellcheck: 'true' },
      handleScrollToSelection: () => isDraggingScrollbar(),
      handleDOMEvents: {
        focus: () => {
          if (editorRef.current) focusEditor(editorRef.current)
          return false
        },
        mousedown: (_view, event) => {
          const scroller = (event.target as HTMLElement | null)?.closest('.note-frame')
          if (!(scroller instanceof HTMLElement) || !isScrollbarHit(scroller, event)) return false
          armScrollbarDrag(scroller, event)
          return true
        }
      }
    },
    onUpdate: ({ editor }) => {
      const content = editor.getJSON()
      updateModule(moduleId, (module) => ({ ...module, content }))
    }
  })

  editorRef.current = editor

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!pinned)
    editor.view.dom.spellcheck = !pinned
  }, [editor, pinned])

  useEffect(() => {
    if (!editor) return undefined
    return registerEditorSnapshot(() => {
      if (editor.isDestroyed) return
      const content = editor.getJSON()
      const current = useDoto.getState().tab?.modules.find((module) => module.id === moduleId)?.content
      if (!notesMatch(current, content)) updateModule(moduleId, (module) => ({ ...module, content }))
    })
  }, [editor, moduleId, updateModule])

  useEffect(() => {
    if (!editor) return undefined
    return () => clearEditor(editor)
  }, [editor])

  return (
    <div className="rich-surface">
      <div
        className="note-frame"
        onPointerDown={(event) => {
          if (isScrollbarHit(event.currentTarget, event)) armScrollbarDrag(event.currentTarget, event)
        }}
      >
        <div className="note-stage" ref={setStage}>
          <EditorContent editor={editor} />
          <InkLayer surface={`module:${moduleId}`} />
          <MediaInk root={stage} surface={`module:${moduleId}`} />
          <AttachmentPins root={stage} editor={editor} />
        </div>
      </div>
    </div>
  )
}
