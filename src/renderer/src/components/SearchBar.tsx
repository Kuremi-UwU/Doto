import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

interface Match {
  from: number
  to: number
}

export default function SearchBar({ editor, onClose }: { editor: Editor | null; onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!editor) return undefined
    const refresh = (): void => setRevision((value) => value + 1)
    editor.on('update', refresh)
    return () => {
      editor.off('update', refresh)
    }
  }, [editor])

  const matches = useMemo(() => (editor && !editor.isDestroyed ? findMatches(editor, query) : []), [editor, query, revision])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const shown = matches.length === 0 ? 0 : Math.min(index, matches.length - 1)

  useEffect(() => {
    const match = matches[shown]
    if (!editor || editor.isDestroyed || !match) return
    try {
      editor.chain().setTextSelection(match).scrollIntoView().run()
    } catch {
      // A match can land outside the document while the note is changing.
    }
  }, [editor, matches, shown])

  const step = (direction: 1 | -1): void => {
    if (matches.length === 0) return
    setIndex((current) => (Math.min(current, matches.length - 1) + direction + matches.length) % matches.length)
  }

  return (
    <form
      className="search-bar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        step(1)
      }}
    >
      <input
        className="search-bar__input"
        aria-label="Search this note"
        placeholder="Search this note"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            step(-1)
          }
          if (event.key === 'Escape') onClose()
        }}
      />
      <span className="search-bar__count">{query ? (matches.length === 0 ? 'No matches' : `${shown + 1} of ${matches.length}`) : ''}</span>
      <button type="button" className="search-bar__button" aria-label="Previous match" title="Previous match" onClick={() => step(-1)}>
        <ChevronUp size={16} />
      </button>
      <button type="button" className="search-bar__button" aria-label="Next match" title="Next match" onClick={() => step(1)}>
        <ChevronDown size={16} />
      </button>
      <button type="button" className="search-bar__button" aria-label="Close search" title="Close" onClick={onClose}>
        <X size={16} />
      </button>
    </form>
  )
}

function findMatches(editor: Editor, query: string): Match[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: Match[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    let start = 0
    while (start <= text.length - needle.length) {
      const found = text.indexOf(needle, start)
      if (found === -1) break
      matches.push({ from: pos + found, to: pos + found + needle.length })
      start = found + needle.length
    }
  })
  return matches
}
