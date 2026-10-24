import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Youtube from '@tiptap/extension-youtube'
import { Placeholder } from '@tiptap/extensions'
import type { Editor } from '@tiptap/react'
import type { NoteContent } from '../../../shared/types'
import { bindVoiceNote } from './voiceNote'
import StarterKit from '@tiptap/starter-kit'

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Segoe UI', value: 'Segoe UI' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Palatino', value: 'Palatino Linotype' },
  { label: 'Garamond', value: 'Garamond' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Courier', value: 'Courier New' },
  { label: 'Cascadia', value: 'Cascadia Code' }
] as const

export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '32px', '48px']

export function createExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: true, autolink: true, defaultProtocol: 'https' }
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TextStyle,
    FontFamily,
    FontSize,
    Image.configure({
      inline: true,
      resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 80, minHeight: 40 }
    }),
    LocalVideo,
    LocalAudio,
    Youtube.configure({
      nocookie: true,
      addPasteHandler: false,
      width: 640,
      height: 360,
      rel: 0
    }),
    Placeholder.configure({ placeholder }),
    TextAlign,
    Indent,
    TabAsNotepad,
    MediaIds
  ]
}

const MEDIA_NODES = new Set(['image', 'youtube', 'localVideo', 'localAudio'])

/** Gives every image and video a stable id so marker ink can stay attached to it. */
const MediaIds = Extension.create({
  name: 'mediaIds',
  addGlobalAttributes() {
    return [
      {
        types: ['image', 'youtube', 'localVideo', 'localAudio'],
        attributes: {
          mediaId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-media-id'),
            renderHTML: (attributes) => {
              const id = attributes.mediaId
              return typeof id === 'string' && id ? { 'data-media-id': id } : {}
            }
          },
          pinned: {
            default: false,
            parseHTML: (element) => element.getAttribute('data-pinned') === 'true',
            renderHTML: (attributes) => (attributes.pinned === true ? { 'data-pinned': 'true' } : {})
          },
          offsetX: {
            default: 0,
            parseHTML: (element) => {
              const value = Number(element.getAttribute('data-offset-x'))
              return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
            },
            renderHTML: (attributes) => {
              const offset = Number(attributes.offsetX)
              return Number.isFinite(offset) && offset > 0 ? { 'data-offset-x': String(Math.round(offset)) } : {}
            }
          }
        }
      }
    ]
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mediaIds'),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          return stampMediaTransaction(state)
        }
      }),
      new Plugin({
        key: new PluginKey('audioGuard'),
        props: {
          handleKeyDown(view, event) {
            const cut = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'x'
            const key = event.key === 'Backspace' || event.key === 'Delete' ? event.key : null
            if (!cut && !key) return false
            if (key && removeEmptyLineBesideAudio(view, key)) {
              event.preventDefault()
              return true
            }
            if (!wouldRemoveAudio(view.state, key ?? 'Delete')) return false
            event.preventDefault()
            return true
          }
        }
      }),
      new Plugin({
        key: new PluginKey('pinnedMedia'),
        props: {
          handleDOMEvents: {
            dragstart(_view, event) {
              const target = event.target
              if (!(target instanceof Element)) return false
              const frame = target.closest('[data-resize-container], .media-frame, [data-youtube-video]')
              const pinned = target.closest('[data-pinned="true"]') || frame?.querySelector('[data-pinned="true"]')
              if (!pinned) return false
              event.preventDefault()
              return true
            }
          },
          handleKeyDown(view, event) {
            const { selection } = view.state
            if (!(selection instanceof NodeSelection) || selection.node.attrs.pinned !== true) return false
            const cut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x'
            if (event.key !== 'Backspace' && event.key !== 'Delete' && !cut) return false
            event.preventDefault()
            return true
          }
        }
      })
    ]
  }
})

/** Drops a blank line that sits against a voice note, without deleting the note. */
function removeEmptyLineBesideAudio(view: EditorView, key: 'Backspace' | 'Delete'): boolean {
  const { state } = view
  const { selection } = state
  if (!selection.empty || !(selection instanceof TextSelection)) return false
  const $from = selection.$from
  if (!$from.parent.isTextblock || $from.parent.content.size > 0 || $from.depth < 1) return false
  const parent = $from.node($from.depth - 1)
  const index = $from.index($from.depth - 1)
  const neighbor = key === 'Backspace' ? (index > 0 ? parent.child(index - 1) : null) : index < parent.childCount - 1 ? parent.child(index + 1) : null
  if (neighbor?.type.name !== 'localAudio' || !parent.canReplace(index, index + 1)) return false
  view.dispatch(state.tr.delete($from.before(), $from.after()).scrollIntoView())
  return true
}

function wouldRemoveAudio(state: EditorState, key: 'Backspace' | 'Delete'): boolean {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'localAudio') return true
  if (!selection.empty) {
    let hit = false
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (node.type.name === 'localAudio') hit = true
    })
    return hit
  }
  const $from = selection.$from
  if (key === 'Backspace') {
    if ($from.nodeBefore?.type.name === 'localAudio') return true
    if ($from.parentOffset === 0 && $from.depth > 0) {
      const before = state.doc.resolve($from.before()).nodeBefore
      if (before?.type.name === 'localAudio') return true
    }
  } else {
    if ($from.nodeAfter?.type.name === 'localAudio') return true
    if ($from.parentOffset === $from.parent.content.size && $from.depth > 0) {
      const after = state.doc.resolve($from.after()).nodeAfter
      if (after?.type.name === 'localAudio') return true
    }
  }
  return false
}

function stampMediaTransaction(state: EditorState): Transaction | null {
  let changed = false
  let tr = state.tr
  state.doc.descendants((node, pos) => {
    if (!MEDIA_NODES.has(node.type.name)) return
    if (typeof node.attrs.mediaId === 'string' && node.attrs.mediaId) return
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, mediaId: crypto.randomUUID() })
    changed = true
  })
  return changed ? tr : null
}

/** Copies note JSON and assigns ids to images and videos that do not have one yet. */
export function withMediaIds(content: NoteContent | null): NoteContent | null {
  if (!content) return content
  const copy = structuredClone(content)
  stampMediaJson(copy)
  nestImages(copy)
  return copy
}

/** Older notes stored each picture as its own block. Inline pictures live in a paragraph so several can share a row. */
function nestImages(node: Record<string, unknown>): void {
  if (!Array.isArray(node.content)) return
  const parent = typeof node.type === 'string' ? node.type : 'doc'
  const inlineParent = parent === 'paragraph' || parent === 'heading'
  const next: unknown[] = []
  let row: Record<string, unknown>[] = []
  const flush = (): void => {
    if (row.length === 0) return
    next.push({ type: 'paragraph', content: row })
    row = []
  }
  for (const child of node.content) {
    if (!child || typeof child !== 'object') {
      flush()
      next.push(child)
      continue
    }
    const record = child as Record<string, unknown>
    nestImages(record)
    if (record.type === 'image' && !inlineParent) {
      row.push(record)
      continue
    }
    flush()
    next.push(record)
  }
  flush()
  node.content = next
}

function stampMediaJson(node: Record<string, unknown>): void {
  if (typeof node.type === 'string' && MEDIA_NODES.has(node.type)) {
    const attrs = node.attrs && typeof node.attrs === 'object' ? { ...(node.attrs as Record<string, unknown>) } : {}
    if (typeof attrs.mediaId !== 'string' || attrs.mediaId.length === 0) attrs.mediaId = crypto.randomUUID()
    node.attrs = attrs
  }
  if (!Array.isArray(node.content)) return
  for (const child of node.content) {
    if (child && typeof child === 'object') stampMediaJson(child as Record<string, unknown>)
  }
}

const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: null,
            parseHTML: (element) => {
              const level = Number(element.getAttribute('data-indent'))
              return Number.isInteger(level) && level > 0 ? level : null
            },
            renderHTML: (attributes) => {
              const level = Number(attributes.indent)
              return Number.isInteger(level) && level > 0 ? { 'data-indent': String(level) } : {}
            }
          }
        }
      }
    ]
  }
})

const TextAlign = Extension.create({
  name: 'textAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['heading', 'paragraph'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.style.textAlign || null,
            renderHTML: (attributes) => {
              const align = attributes.textAlign as string | null
              if (!align || align === 'left') return {}
              return { style: `text-align: ${align}` }
            }
          }
        }
      }
    ]
  }
})

/** Windows Notepad advances to the next stop every 8 columns. */
const NOTEPAD_TAB_STOP = 8

/** Tab stays in the note and inserts a Notepad-sized tab instead of moving focus. */
const TabAsNotepad = Extension.create({
  name: 'tabAsNotepad',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) tr.insertText('\t')
          return true
        })
      },
      'Shift-Tab': () => !this.editor.isActive('table')
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('notepadTabStops'),
        props: {
          decorations(state) {
            const marks: Decoration[] = []
            state.doc.descendants((block, pos) => {
              if (!block.isTextblock) return
              let column = 0
              block.descendants((child, childPos) => {
                if (child.type.name === 'hardBreak') {
                  column = 0
                  return
                }
                if (!child.isText || !child.text) return
                for (let index = 0; index < child.text.length; index += 1) {
                  if (child.text[index] !== '\t') {
                    column += 1
                    continue
                  }
                  const columns = NOTEPAD_TAB_STOP - (column % NOTEPAD_TAB_STOP)
                  const at = pos + 1 + childPos + index
                  marks.push(Decoration.inline(at, at + 1, { class: 'note-tab', style: `width:${columns}ch` }))
                  column += columns
                }
              })
              return false
            })
            return DecorationSet.create(state.doc, marks)
          }
        }
      })
    ]
  }
})

/** Returns the video id from a YouTube watch, youtu.be, Shorts, live or embed link, or `null` for anything else. */
export function youtubeVideoId(input: string): string | null {
  const text = input.trim()
  if (!text) return null

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^(www|m|music)\./, '')
  const [first, second] = url.pathname.split('/').filter(Boolean)
  let id: string | null | undefined
  if (host === 'youtu.be') {
    id = first
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (first === 'watch') id = url.searchParams.get('v')
    else if (first === 'shorts' || first === 'embed' || first === 'live') id = second
  }
  return id && VIDEO_ID_PATTERN.test(id) ? id : null
}

export function insertImages(editor: Editor, sources: string[]): void {
  const images = sources.map((src) => ({ type: 'image', attrs: { src, mediaId: crypto.randomUUID() } }))
  const chain = editor.chain().focus()
  const { selection } = editor.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'image') chain.setTextSelection(selection.to)
  chain.insertContent(images).run()
}

const LocalVideo = Node.create({
  name: 'localVideo',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'video[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true', playsinline: 'true' })]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'media-frame'
      const video = document.createElement('video')
      video.controls = true
      video.setAttribute('playsinline', 'true')
      const apply = (current: typeof node): void => {
        const src = typeof current.attrs.src === 'string' ? current.attrs.src : ''
        if (video.getAttribute('src') !== src) {
          if (src) video.src = src
          else video.removeAttribute('src')
        }
        const id = typeof current.attrs.mediaId === 'string' ? current.attrs.mediaId : ''
        if (id) dom.dataset.mediaId = id
        else delete dom.dataset.mediaId
        if (current.attrs.pinned === true) dom.dataset.pinned = 'true'
        else delete dom.dataset.pinned
        const offset = Number(current.attrs.offsetX)
        if (Number.isFinite(offset) && offset > 0) dom.dataset.offsetX = String(Math.round(offset))
        else delete dom.dataset.offsetX
      }
      apply(node)
      dom.appendChild(video)
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'localVideo') return false
          apply(updated)
          return true
        },
        ignoreMutation() {
          return true
        }
      }
    }
  }
})

export function setAttachmentOffset(editor: Editor, mediaId: string, offsetX: number): void {
  const found = locateMedia(editor.state.doc, mediaId)
  if (!found) return
  const next = Math.max(0, Math.round(offsetX))
  if (Number(found.attrs.offsetX) === next) return
  editor.view.dispatch(editor.state.tr.setNodeMarkup(found.pos, undefined, { ...found.attrs, offsetX: next }))
}

export function mediaSrc(editor: Editor, mediaId: string): string | null {
  const found = locateMedia(editor.state.doc, mediaId)
  const src = found?.attrs.src
  return typeof src === 'string' && src ? src : null
}

export function deleteAttachment(editor: Editor, mediaId: string): void {
  const found = locateMedia(editor.state.doc, mediaId)
  if (!found) return
  const node = editor.state.doc.nodeAt(found.pos)
  if (!node) return
  editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + node.nodeSize))
}

export function toggleAttachmentPin(editor: Editor, mediaId: string): void {
  const found = locateMedia(editor.state.doc, mediaId)
  if (!found) return
  editor.view.dispatch(editor.state.tr.setNodeMarkup(found.pos, undefined, { ...found.attrs, pinned: found.attrs.pinned !== true }))
}

function locateMedia(doc: EditorState['doc'], mediaId: string): { pos: number; attrs: Record<string, unknown> } | null {
  let match: { pos: number; attrs: Record<string, unknown> } | null = null
  doc.descendants((node, pos) => {
    if (match || !MEDIA_NODES.has(node.type.name) || node.attrs.mediaId !== mediaId) return
    match = { pos, attrs: { ...node.attrs } }
    return false
  })
  return match
}

const LocalAudio = Node.create({
  name: 'localAudio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      duration: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('data-duration'))
          return Number.isFinite(value) && value > 0 ? Math.round(value) : null
        },
        renderHTML: (attributes) => {
          const value = Number(attributes.duration)
          return Number.isFinite(value) && value > 0 ? { 'data-duration': String(Math.round(value)) } : {}
        }
      }
    }
  },
  parseHTML() {
    return [{ tag: 'audio[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true' })]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'media-frame media-frame--audio voice-note'
      const audio = document.createElement('audio')
      bindVoiceNote(dom, audio)
      const apply = (current: typeof node): void => {
        const src = typeof current.attrs.src === 'string' ? current.attrs.src : ''
        if (audio.getAttribute('src') !== src) {
          if (src) audio.src = src
          else audio.removeAttribute('src')
        }
        const id = typeof current.attrs.mediaId === 'string' ? current.attrs.mediaId : ''
        if (id) dom.dataset.mediaId = id
        else delete dom.dataset.mediaId
        const seconds = Number(current.attrs.duration)
        if (Number.isFinite(seconds) && seconds > 0) dom.dataset.duration = String(Math.round(seconds))
        else delete dom.dataset.duration
        dom.dispatchEvent(new Event('doto-duration'))
      }
      apply(node)
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'localAudio') return false
          apply(updated)
          return true
        },
        ignoreMutation() {
          return true
        }
      }
    }
  }
})

export function insertLocalAudio(editor: Editor, src: string, duration = 0): void {
  const seconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null
  editor.chain().focus().insertContent({ type: 'localAudio', attrs: { src, ...(seconds ? { duration: seconds } : {}) } }).run()
}

/** Points a just-inserted clip at its saved file, or removes it when saving failed. */
export function replaceAudioSrc(editor: Editor, from: string, to: string | null): void {
  const spots: Array<{ pos: number; size: number; attrs: Record<string, unknown> }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'localAudio' && node.attrs.src === from) spots.push({ pos, size: node.nodeSize, attrs: { ...node.attrs } })
  })
  if (spots.length === 0 || editor.isDestroyed) return
  let tr = editor.state.tr
  for (const spot of spots.reverse()) {
    const pos = tr.mapping.map(spot.pos)
    tr = to ? tr.setNodeMarkup(pos, undefined, { ...spot.attrs, src: to }) : tr.delete(pos, pos + spot.size)
  }
  editor.view.dispatch(tr)
}

export function insertLocalVideo(editor: Editor, src: string): void {
  editor.chain().focus().insertContent({ type: 'localVideo', attrs: { src } }).run()
}

export function insertVideo(editor: Editor, videoId: string): void {
  editor
    .chain()
    .focus()
    .setYoutubeVideo({ src: `https://www.youtube.com/watch?v=${videoId}` })
    .run()
}
