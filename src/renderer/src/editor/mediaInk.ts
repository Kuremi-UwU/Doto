import type { InkStroke } from '../../../shared/types'

export interface MediaTarget {
  id: string
  host: HTMLElement
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The element whose box the ink should follow: the image frame, or the video itself. */
export function hostFor(marked: HTMLElement): HTMLElement {
  if (marked instanceof HTMLIFrameElement) return marked
  return marked.closest<HTMLElement>('.media-frame') ?? marked.closest<HTMLElement>('[data-resize-wrapper]') ?? marked
}

export function findMediaHosts(stage: HTMLElement): MediaTarget[] {
  const found: MediaTarget[] = []
  const seen = new Set<string>()
  stage.querySelectorAll<HTMLElement>('[data-media-id]').forEach((element) => {
    const id = element.dataset.mediaId
    if (!id || seen.has(id)) return
    const host = hostFor(element)
    if (!stage.contains(host)) return
    seen.add(id)
    found.push({ id, host })
  })
  return found
}

/** The attachment under the pointer, ignoring the drawing canvas that sits above the note. */
export function mediaAt(x: number, y: number, canvas: HTMLElement): MediaTarget | null {
  const stage = canvas.parentElement
  if (!stage) return null
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement) || element === canvas || element.classList.contains('ink-layer')) continue
    const marked = element.closest<HTMLElement>('[data-media-id]')
    if (!marked || !stage.contains(marked)) continue
    const id = marked.dataset.mediaId
    if (!id) continue
    const host = hostFor(marked)
    if (!stage.contains(host)) continue
    return { id, host }
  }
  return null
}

const mediaCanvases = new Map<string, HTMLCanvasElement>()
const freshErases = new Set<string>()
let liveStroke: InkStroke | null = null

export function setLiveMediaStroke(stroke: InkStroke | null): void {
  liveStroke = stroke
}

export function liveMediaStroke(): InkStroke | null {
  return liveStroke
}

/** The bitmap already shows this erase, so the next React paint can leave it alone. */
export function markFreshErase(id: string): void {
  freshErases.add(id)
}

export function takeFreshErase(id: string): boolean {
  return freshErases.delete(id)
}

export function registerMediaCanvas(id: string, canvas: HTMLCanvasElement): void {
  mediaCanvases.set(id, canvas)
}

export function unregisterMediaCanvas(id: string, canvas: HTMLCanvasElement): void {
  if (mediaCanvases.get(id) === canvas) mediaCanvases.delete(id)
}

export function mediaCanvas(id: string): HTMLCanvasElement | undefined {
  const canvas = mediaCanvases.get(id)
  return canvas?.isConnected ? canvas : undefined
}

/** Where a canvas can live. Images and iframes cannot hold children, so the canvas sits beside them. */
export function overlayParent(host: HTMLElement): HTMLElement | null {
  if (host instanceof HTMLIFrameElement || host instanceof HTMLImageElement || host instanceof HTMLVideoElement) return host.parentElement
  return host
}

export function placeMediaCanvas(canvas: HTMLCanvasElement, host: HTMLElement): { width: number; height: number } | null {
  const parent = canvas.parentElement
  if (!parent) return null
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
  const hostRect = host.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  const width = Math.max(1, hostRect.width)
  const height = Math.max(1, hostRect.height)
  canvas.style.left = `${hostRect.left - parentRect.left}px`
  canvas.style.top = `${hostRect.top - parentRect.top}px`
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  return { width, height }
}

/** Stores a stroke in the attachment's own coordinates so a later move or resize keeps it in place. */
export function bindStrokeToMedia(stroke: InkStroke, target: MediaTarget | null, origin: HTMLElement): InkStroke {
  if (!target || stroke.points.length === 0) return stroke
  const box = boxWithin(target.host, origin)
  if (box.width < 1 || box.height < 1) return stroke
  return {
    ...stroke,
    surface: `media:${target.id}`,
    basis: box.width,
    points: stroke.points.map((point) => ({
      x: (point.x - box.left) / box.width,
      y: (point.y - box.top) / box.height
    }))
  }
}

/** Moves page strokes that already sit entirely on an attachment onto that attachment. */
export function claimStrokes(ink: InkStroke[], stage: HTMLElement, surface: string): InkStroke[] | null {
  const origin = stage.querySelector<HTMLElement>(':scope > .ink-layer:not(.ink-layer--media)') ?? stage
  const hosts = findMediaHosts(stage)
    .map((target) => ({ ...target, box: boxWithin(target.host, origin) }))
    .filter((target) => target.box.width > 1 && target.box.height > 1)
  if (hosts.length === 0) return null
  let changed = false
  const next = ink.map((stroke) => {
    if (stroke.surface !== surface || stroke.points.length === 0) return stroke
    const match = hosts
      .filter((target) => covers(target.box, stroke.points))
      .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0]
    if (!match) return stroke
    changed = true
    return {
      ...stroke,
      surface: `media:${match.id}`,
      basis: match.box.width,
      points: stroke.points.map((point) => ({
        x: (point.x - match.box.left) / match.box.width,
        y: (point.y - match.box.top) / match.box.height
      }))
    }
  })
  return changed ? next : null
}

function boxWithin(host: HTMLElement, origin: HTMLElement): Box {
  const hostRect = host.getBoundingClientRect()
  const originRect = origin.getBoundingClientRect()
  return {
    left: hostRect.left - originRect.left,
    top: hostRect.top - originRect.top,
    width: hostRect.width,
    height: hostRect.height
  }
}

function covers(box: Box, points: { x: number; y: number }[]): boolean {
  return points.every((point) => point.x >= box.left - 2 && point.y >= box.top - 2 && point.x <= box.left + box.width + 2 && point.y <= box.top + box.height + 2)
}
