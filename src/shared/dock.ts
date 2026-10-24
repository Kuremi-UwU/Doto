import { DOCK_IDS, type DockItemId, type DockLayout, type DockSide } from './types'

export const DEFAULT_DOCK: DockLayout = {
  left: ['save', 'marker', 'search', 'frame'],
  center: ['todo', 'notes', 'image', 'video', 'audio'],
  right: []
}

const SIDES: DockSide[] = ['left', 'center', 'right']

export function normalizeDock(value: unknown): DockLayout {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const seen = new Set<string>()
  const layout: DockLayout = { left: [], center: [], right: [] }
  for (const side of SIDES) {
    const list = data[side]
    if (!Array.isArray(list)) continue
    for (const id of list) {
      if (typeof id === 'string' && isDockId(id) && !seen.has(id)) {
        seen.add(id)
        layout[side].push(id)
      }
    }
  }
  for (const side of SIDES) {
    for (const id of DEFAULT_DOCK[side]) {
      if (!seen.has(id)) {
        seen.add(id)
        layout[side].push(id)
      }
    }
  }
  return layout
}

function isDockId(id: string): id is DockItemId {
  return (DOCK_IDS as readonly string[]).includes(id)
}

export function moveDockItem(layout: DockLayout, id: DockItemId, side: DockSide, index: number): DockLayout {
  const next: DockLayout = {
    left: layout.left.filter((item) => item !== id),
    center: layout.center.filter((item) => item !== id),
    right: layout.right.filter((item) => item !== id)
  }
  const list = [...next[side]]
  list.splice(Math.max(0, Math.min(index, list.length)), 0, id)
  next[side] = list
  return next
}
