import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { InkStroke, InkTool } from '../../../shared/types'
import { bindStrokeToMedia, markFreshErase, mediaAt, mediaCanvas, setLiveMediaStroke, type MediaTarget } from '../editor/mediaInk'
import { cx } from '../cx'
import { useDoto } from '../store'

const MAX_STROKES = 500

export default function InkLayer({ surface }: { surface: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draft = useRef<InkStroke | null>(null)
  const media = useRef<MediaTarget | null>(null)
  const active = useDoto((state) => state.marker.active)
  const tool = useDoto((state) => state.marker.tool)
  const ink = useDoto((state) => state.tab?.ink ?? EMPTY)
  const strokes = useMemo(() => ink.filter((stroke) => stroke.surface === surface), [ink, surface])

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return undefined
    const paint = (): void => draw(canvas, strokes, draft.current)
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [strokes])

  const pointFrom = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const commit = (): void => {
    const stroke = draft.current
    const target = media.current
    draft.current = null
    media.current = null
    if (!stroke || stroke.points.length === 0) {
      setLiveMediaStroke(null)
      return
    }
    const canvas = canvasRef.current
    const placed = canvas ? bindStrokeToMedia(stroke, target, canvas) : stroke
    if (target && stroke.tool === 'eraser') {
      setLiveMediaStroke(placed)
      markFreshErase(target.id)
    } else setLiveMediaStroke(null)
    const ink = useDoto.getState().tab?.ink ?? []
    useDoto.getState().setInk([...ink, placed].slice(-MAX_STROKES))
    if (canvas) draw(canvas, strokes, null)
  }

  return (
    <canvas
      ref={canvasRef}
      className={cx('ink-layer', active && 'is-active', active && tool === 'eraser' && 'is-eraser')}
      onPointerDown={(event) => {
        if (!active || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const marker = useDoto.getState().marker
        media.current = mediaAt(event.clientX, event.clientY, event.currentTarget)
        const point = pointFrom(event)
        const size = marker.tool === 'eraser' ? marker.eraserSize : marker.size
        const stroke = { id: crypto.randomUUID(), surface, tool: marker.tool, color: marker.color, size, points: [point] }
        draft.current = stroke
        if (media.current && marker.tool === 'eraser') {
          setLiveMediaStroke(bindStrokeToMedia(stroke, media.current, event.currentTarget))
          eraseOnMedia(event.currentTarget, media.current, point, point, size)
        } else if (canvasRef.current) draw(canvasRef.current, strokes, stroke)
      }}
      onPointerMove={(event) => {
        const stroke = draft.current
        if (!stroke) return
        const next = pointFrom(event)
        const last = stroke.points[stroke.points.length - 1]
        if (last && Math.hypot(next.x - last.x, next.y - last.y) < 1.2) return
        stroke.points.push(next)
        const target = media.current
        if (target && stroke.tool === 'eraser' && last) {
          setLiveMediaStroke(bindStrokeToMedia(stroke, target, event.currentTarget))
          eraseOnMedia(event.currentTarget, target, last, next, stroke.size)
        }
        else if (canvasRef.current) draw(canvasRef.current, strokes, stroke)
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
    />
  )
}

const EMPTY: InkStroke[] = []

/** Circle that follows the pointer while the eraser is selected. */
export function EraserCursor(): React.JSX.Element | null {
  const active = useDoto((state) => state.marker.active && state.marker.tool === 'eraser')
  const size = useDoto((state) => state.marker.eraserSize)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return undefined
    const ring = ref.current
    if (!ring) return undefined
    const move = (event: PointerEvent): void => {
      const over = event.target instanceof Element && Boolean(event.target.closest('.note-stage, .note-sheet'))
      ring.hidden = !over
      if (!over) return
      ring.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [active])

  if (!active) return null
  const diameter = eraserWidth(size)
  return <div ref={ref} className="eraser-ring" hidden style={{ width: diameter, height: diameter }} />
}

function draw(canvas: HTMLCanvasElement, strokes: InkStroke[], current: InkStroke | null): void {
  const parent = canvas.parentElement
  if (!parent) return
  paintInk(canvas, Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight), strokes, current, false)
}

/** Paints strokes that are stored as fractions of an image or video box. */
export function drawMediaInk(canvas: HTMLCanvasElement, strokes: InkStroke[], width: number, height: number): void {
  paintInk(canvas, Math.max(1, width), Math.max(1, height), strokes, null, true)
}

function paintInk(canvas: HTMLCanvasElement, width: number, height: number, strokes: InkStroke[], current: InkStroke | null, ratioSpace: boolean): void {
  const ratio = window.devicePixelRatio || 1
  const pixelWidth = Math.floor(width * ratio)
  const pixelHeight = Math.floor(height * ratio)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  if (!ratioSpace) {
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  for (const stroke of strokes) paint(context, stroke, width, height, ratioSpace)
  if (current) paint(context, current, width, height, ratioSpace)
}

function paint(context: CanvasRenderingContext2D, stroke: InkStroke, width: number, height: number, ratioSpace: boolean): void {
  const [first, ...rest] = stroke.points
  if (!first) return
  const pointAt = (point: { x: number; y: number }): { x: number; y: number } => (ratioSpace ? { x: point.x * width, y: point.y * height } : point)
  const scale = ratioSpace && stroke.basis ? width / stroke.basis : 1
  const start = pointAt(first)
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  applyTool(context, stroke.tool, stroke.color, stroke.size)
  context.lineWidth *= scale
  context.beginPath()
  context.moveTo(start.x, start.y)
  if (rest.length === 0) context.lineTo(start.x + 0.01, start.y)
  else for (const point of rest) {
    const next = pointAt(point)
    context.lineTo(next.x, next.y)
  }
  context.stroke()
  context.restore()
}

export function eraserWidth(size: number): number {
  return Math.min(100, Math.max(2, size))
}

/** Punches the latest bit of an eraser stroke out of an image immediately, without redrawing the whole note. */
function eraseOnMedia(origin: HTMLCanvasElement, target: MediaTarget, from: { x: number; y: number }, to: { x: number; y: number }, size: number): void {
  const canvas = mediaCanvas(target.id)
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  const originRect = origin.getBoundingClientRect()
  const hostRect = target.host.getBoundingClientRect()
  const shiftX = hostRect.left - originRect.left
  const shiftY = hostRect.top - originRect.top
  const ratio = window.devicePixelRatio || 1
  context.save()
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.globalCompositeOperation = 'destination-out'
  context.strokeStyle = 'rgba(0,0,0,1)'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = eraserWidth(size)
  context.beginPath()
  context.moveTo(from.x - shiftX, from.y - shiftY)
  context.lineTo(to.x - shiftX + 0.01, to.y - shiftY)
  context.stroke()
  context.restore()
}

function applyTool(context: CanvasRenderingContext2D, tool: InkTool, color: string, size: number): void {
  if (tool === 'eraser') {
    context.globalCompositeOperation = 'destination-out'
    context.strokeStyle = 'rgba(0,0,0,1)'
    context.lineWidth = eraserWidth(size)
    return
  }
  context.globalCompositeOperation = 'source-over'
  context.strokeStyle = color
  if (tool === 'highlighter') {
    context.globalAlpha = 0.35
    context.lineWidth = Math.max(size * 3, 14)
    return
  }
  context.lineWidth = size
}
