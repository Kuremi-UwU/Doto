import type { NoteContent } from '../../../shared/types'
import { contentHasInformation } from '../../../shared/stats'

const readers = new Set<() => void>()

/** Editors register so a save can copy text that has not reached the store yet. */
export function registerEditorSnapshot(read: () => void): () => void {
  readers.add(read)
  return () => {
    readers.delete(read)
  }
}

export function snapshotEditors(): void {
  for (const read of readers) read()
}

let pageApply: ((content: NoteContent | null) => void) | null = null

/** The open page applies content that was restored without remounting the editor. */
export function registerPageContent(apply: (content: NoteContent | null) => void): () => void {
  pageApply = apply
  return () => {
    if (pageApply === apply) pageApply = null
  }
}

export function applyPageContent(content: NoteContent | null): void {
  pageApply?.(content)
}

/** An untouched note is stored as `null` while the editor holds an empty document. */
export function notesMatch(stored: NoteContent | null | undefined, next: NoteContent): boolean {
  if (JSON.stringify(stored ?? null) === JSON.stringify(next)) return true
  return stored == null && !contentHasInformation(next)
}
