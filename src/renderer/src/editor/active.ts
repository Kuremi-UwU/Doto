import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

let current: Editor | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** The editor that Image and Video should insert into. */
export function focusEditor(editor: Editor): void {
  if (current === editor) return
  current = editor
  notify()
}

export function clearEditor(editor: Editor): void {
  if (current !== editor) return
  current = null
  notify()
}

export function getActiveEditor(): Editor | null {
  return current && !current.isDestroyed ? current : null
}

export function useActiveEditor(): Editor | null {
  const [editor, setEditor] = useState<Editor | null>(getActiveEditor())

  useEffect(() => {
    const sync = (): void => setEditor(getActiveEditor())
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  return editor
}
