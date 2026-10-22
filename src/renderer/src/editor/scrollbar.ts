let draggingScrollbar = false

export function isDraggingScrollbar(): boolean {
  return draggingScrollbar
}

/** True when the pointer is on the element's own scrollbar, not its content. */
export function isScrollbarHit(element: HTMLElement, event: { clientX: number; clientY: number }): boolean {
  const rect = element.getBoundingClientRect()
  const vertical = element.offsetWidth - element.clientWidth
  const horizontal = element.offsetHeight - element.clientHeight
  if (vertical > 1 && event.clientX >= rect.right - vertical - 2) return true
  if (horizontal > 1 && event.clientY >= rect.bottom - horizontal - 2) return true
  return false
}

/** Remembers a scrollbar drag so the editor does not jump the caret back into view. */
export function armScrollbarDrag(element: HTMLElement, event: { clientX: number; clientY: number }): void {
  if (!isScrollbarHit(element, event)) return
  draggingScrollbar = true
  const stop = (): void => {
    draggingScrollbar = false
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
