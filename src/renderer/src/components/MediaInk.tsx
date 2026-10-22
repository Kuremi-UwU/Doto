import { useEffect, useMemo, useRef } from 'react'
import type { InkStroke } from '../../../shared/types'
import { claimStrokes, findMediaHosts, liveMediaStroke, placeMediaCanvas, registerMediaCanvas, setLiveMediaStroke, takeFreshErase, unregisterMediaCanvas } from '../editor/mediaInk'
import { drawMediaInk } from './InkLayer'
import { useDoto } from '../store'

const EMPTY: [] = []

/** Draws marker ink on each image and video, in that attachment's own box. */
export default function MediaInk({ root, surface }: { root: HTMLElement | null; surface: string }): null {
  const ink = useDoto((state) => state.tab?.ink ?? EMPTY)
  const mediaStrokes = useMemo(() => ink.filter((stroke) => stroke.surface.startsWith('media:')), [ink])

  const seen = useRef(new Set<string>())
  const canvases = useRef(new Map<string, HTMLCanvasElement>())
  const strokesRef = useRef(mediaStrokes)
  strokesRef.current = mediaStrokes

  useEffect(() => {
    if (!root) return undefined
    let frame = 0
    const claim = (): void => {
      const ready = findMediaHosts(root).filter((target) => {
        const rect = target.host.getBoundingClientRect()
        return rect.width > 1 && rect.height > 1 && !seen.current.has(target.id)
      })
      if (ready.length === 0) return
      for (const target of ready) seen.current.add(target.id)
      const next = claimStrokes(useDoto.getState().tab?.ink ?? [], root, surface)
      if (next) useDoto.getState().setInk(next)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(claim)
    }
    schedule()
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-media-id', 'style', 'width', 'height'] })
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [root, surface])

  useEffect(() => {
    if (!root) return undefined
    const map = canvases.current
    const watching = new Set<Element>()
    let frame = 0
    const paint = (id: string, canvas: HTMLCanvasElement, host: HTMLElement): void => {
      const box = placeMediaCanvas(canvas, host)
      if (!box) return
      drawMediaInk(canvas, strokesOn(id, strokesRef.current), box.width, box.height)
    }
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    })

    const sync = (): void => {
      const present = new Set<string>()
      for (const { id, host } of findMediaHosts(root)) {
        present.add(id)
        if (!watching.has(host)) {
          watching.add(host)
          resize.observe(host)
        }
        let canvas = map.get(id)
        if (!canvas || canvas.parentElement !== root) {
          if (canvas) unregisterMediaCanvas(id, canvas)
          canvas?.remove()
          canvas = document.createElement('canvas')
          canvas.className = 'ink-layer ink-layer--media'
          root.appendChild(canvas)
          map.set(id, canvas)
          registerMediaCanvas(id, canvas)
        }
        paint(id, canvas, host)
      }
      for (const [id, canvas] of map) {
        if (present.has(id)) continue
        unregisterMediaCanvas(id, canvas)
        canvas.remove()
        map.delete(id)
      }
    }

    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    })
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-media-id', 'style', 'width', 'height', 'class'] })
    resize.observe(root)
    sync()

    return () => {
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      for (const [id, canvas] of map) unregisterMediaCanvas(id, canvas)
      for (const canvas of map.values()) canvas.remove()
      map.clear()
    }
  }, [root])

  useEffect(() => {
    if (!root) return
    for (const { id, host } of findMediaHosts(root)) {
      if (takeFreshErase(id)) {
        if (liveMediaStroke()?.surface === `media:${id}`) setLiveMediaStroke(null)
        continue
      }
      const canvas = canvases.current.get(id)
      if (!canvas) continue
      const box = placeMediaCanvas(canvas, host)
      if (!box) continue
      drawMediaInk(canvas, strokesOn(id, mediaStrokes), box.width, box.height)
    }
  }, [root, mediaStrokes])

  return null
}

function strokesOn(id: string, strokes: readonly InkStroke[]): InkStroke[] {
  const mine = strokes.filter((stroke) => stroke.surface === `media:${id}`)
  const live = liveMediaStroke()
  return live?.surface === `media:${id}` ? [...mine, live] : mine
}
