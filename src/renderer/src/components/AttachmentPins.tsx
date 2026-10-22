import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { deleteAttachment, setAttachmentOffset, toggleAttachmentPin } from '../editor/extensions'
import { findMediaHosts } from '../editor/mediaInk'
import { useDoto } from '../store'
import { askConfirm } from './ConfirmDialog'

const PIN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'

/** A pin on each image and video. Pinned attachments stay put and cannot be resized or deleted. */
export default function AttachmentPins({ root, editor }: { root: HTMLElement | null; editor: Editor | null }): null {
  const editorRef = useRef(editor)
  editorRef.current = editor

  useEffect(() => {
    if (!root) return undefined
    const stage = root
    const buttons = new Map<string, { button: HTMLButtonElement; host: HTMLElement }>()
    let frame = 0

    const place = (button: HTMLButtonElement, host: HTMLElement): void => {
      const rootRect = root.getBoundingClientRect()
      const box = host.getBoundingClientRect()
      button.style.left = `${box.right - rootRect.left - 30}px`
      button.style.top = `${box.top - rootRect.top + 8}px`
    }

    const sync = (): void => {
      const present = new Set<string>()
      for (const { id, host } of findMediaHosts(root)) {
        present.add(id)
        const pinned = attachmentPinned(host)
        let entry = buttons.get(id)
        if (!entry) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'attachment-pin'
          button.innerHTML = PIN_ICON
          button.addEventListener('pointerdown', (event) => {
            event.preventDefault()
            event.stopPropagation()
          })
          button.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const live = editorRef.current
            if (live && !live.isDestroyed) toggleAttachmentPin(live, id)
          })
          root.appendChild(button)
          entry = { button, host }
          buttons.set(id, entry)
        }
        entry.host = host
        entry.button.classList.toggle('is-pinned', pinned)
        entry.button.title = pinned ? 'Unpin. This attachment is locked.' : 'Pin. Lock this attachment in place.'
        entry.button.setAttribute('aria-label', entry.button.title)
        entry.button.setAttribute('aria-pressed', String(pinned))
        place(entry.button, host)
        const shell = moveShell(host)
        shell.classList.toggle('is-movable', !pinned && slideRoom(shell) >= 2 && shell.dataset.shifting !== 'true')
        if (shell.dataset.shifting !== 'true') applySlide(shell)
      }
      for (const [id, entry] of buttons) {
        if (present.has(id)) continue
        entry.button.remove()
        buttons.delete(id)
      }
    }

    const point = (event: PointerEvent): void => {
      for (const { button, host } of buttons.values()) {
        const box = host.getBoundingClientRect()
        const near = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
        button.classList.toggle('is-near', near)
      }
    }

    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    }
    schedule()
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-media-id', 'data-pinned', 'data-offset-x', 'style', 'width', 'height'] })
    const scroller = root.closest('.note-scroll, .note-frame')
    scroller?.addEventListener('scroll', schedule, { passive: true })
    root.addEventListener('pointermove', point)
    root.addEventListener('contextmenu', confirmDelete, true)
    root.addEventListener('pointerdown', beginSlide, true)
    root.addEventListener('mousedown', keepSlide, true)
    root.addEventListener('dragstart', blockNodeDrag, true)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      scroller?.removeEventListener('scroll', schedule)
      root.removeEventListener('pointermove', point)
      root.removeEventListener('contextmenu', confirmDelete, true)
      root.removeEventListener('pointerdown', beginSlide, true)
      root.removeEventListener('mousedown', keepSlide, true)
      root.removeEventListener('dragstart', blockNodeDrag, true)
      for (const entry of buttons.values()) entry.button.remove()
    }

    function confirmDelete(event: MouseEvent): void {
      const hit = attachmentTarget(event.target)
      if (!hit) return
      event.preventDefault()
      event.stopPropagation()
      window.doto.claimEditorMenu()
      const name = hit.kind === 'image' ? 'image' : 'video'
      askConfirm({
        title: `Delete this ${name}?`,
        message: 'This removes it from the note.',
        confirmLabel: 'Delete',
        run: () => {
          const live = editorRef.current
          if (live && !live.isDestroyed) deleteAttachment(live, hit.id)
          const ink = useDoto.getState().tab?.ink ?? []
          useDoto.getState().setInk(ink.filter((stroke) => stroke.surface !== `media:${hit.id}`))
        }
      })
    }

    function slidableTarget(target: EventTarget | null): { id: string; marked: HTMLElement; shell: HTMLElement } | null {
      if (!(target instanceof Element) || target.closest('.attachment-pin, [data-resize-handle]')) return null
      const marked = target.closest<HTMLElement>('[data-media-id]')
      if (!marked || !stage.contains(marked)) return null
      const id = marked.dataset.mediaId
      const shell = moveShell(marked)
      if (!id || attachmentPinned(marked) || slideRoom(shell) < 2) return null
      return { id, marked, shell }
    }

    function keepSlide(event: MouseEvent): void {
      if (!slidableTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
    }

    function blockNodeDrag(event: DragEvent): void {
      if (slidableTarget(event.target) || (event.target instanceof Element && event.target.closest('[data-shifting="true"]'))) event.preventDefault()
    }

    function beginSlide(event: PointerEvent): void {
      const hit = slidableTarget(event.target)
      if (!hit || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const { id, shell } = hit
      const startX = event.clientX
      const start = Math.min(readOffset(shell), slideRoom(shell))
      let latest = start
      const move = (pointer: PointerEvent): void => {
        if (Math.abs(pointer.clientX - startX) < 3 && latest === start) return
        latest = Math.min(slideRoom(shell), Math.max(0, start + pointer.clientX - startX))
        shell.dataset.shifting = 'true'
        shell.classList.add('is-shifting')
        shell.classList.remove('is-movable')
        shell.style.transform = ''
        shell.style.marginLeft = latest > 0 ? `${latest}px` : ''
        const entry = buttons.get(id)
        if (entry) place(entry.button, entry.host)
      }
      const end = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        const moved = shell.dataset.shifting === 'true'
        delete shell.dataset.shifting
        shell.classList.remove('is-shifting')
        if (!moved) return
        const live = editorRef.current
        if (live && !live.isDestroyed) setAttachmentOffset(live, id, latest)
        applySlide(shell)
        shell.classList.toggle('is-movable', slideRoom(shell) >= 2)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
  }, [root])

  return null
}

function attachmentTarget(target: EventTarget | null): { id: string; kind: 'image' | 'video' } | null {
  if (!(target instanceof Element)) return null
  const marked = target.closest<HTMLElement>('[data-media-id]')
  if (!marked) return null
  const id = marked.dataset.mediaId
  if (!id) return null
  const kind = marked.closest('img, [data-resize-container]') && !marked.closest('video, .media-frame, [data-youtube-video]') ? 'image' : 'video'
  return { id, kind }
}

function attachmentPinned(host: HTMLElement): boolean {
  if (host.getAttribute('data-pinned') === 'true') return true
  return host.querySelector('[data-pinned="true"]') != null
}

function moveShell(marked: HTMLElement): HTMLElement {
  return marked.closest<HTMLElement>('[data-resize-container]') ?? marked.closest<HTMLElement>('.media-frame') ?? marked.closest<HTMLElement>('[data-youtube-video]') ?? marked
}

function readOffset(shell: HTMLElement): number {
  const source = shell.matches('[data-offset-x]') ? shell : shell.querySelector('[data-offset-x]')
  const value = Number(source?.getAttribute('data-offset-x'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function pictured(shell: HTMLElement): HTMLElement {
  const media = shell.querySelector('img, video, iframe')
  return media instanceof HTMLElement ? media : shell
}

/** How far this picture can move right before the row fills the text frame. */
function slideRoom(shell: HTMLElement): number {
  const note = shell.closest('.note')
  if (!(note instanceof HTMLElement)) return 0
  const style = getComputedStyle(note)
  const available = note.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const parent = shell.parentElement
  const shells = parent
    ? [...parent.querySelectorAll<HTMLElement>('[data-resize-container], .media-frame, [data-youtube-video]')]
    : [shell]
  let used = 0
  for (const item of shells) {
    used += pictured(item).getBoundingClientRect().width
    const itemStyle = getComputedStyle(item)
    used += parseFloat(itemStyle.marginRight) || 0
    if (item !== shell) used += parseFloat(itemStyle.marginLeft) || 0
  }
  return Math.max(0, Math.round(available - used))
}

function applySlide(shell: HTMLElement): void {
  if (shell.dataset.shifting === 'true') return
  shell.style.transform = ''
  const used = Math.min(readOffset(shell), slideRoom(shell))
  shell.style.marginLeft = used > 0 ? `${used}px` : ''
}
