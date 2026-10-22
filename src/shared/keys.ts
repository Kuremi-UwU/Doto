import type { AppCommand, Keybinds } from './types'

export const DEFAULT_KEYBINDS: Keybinds = {
  save: 'Ctrl+S',
  find: 'Ctrl+F',
  marker: 'Ctrl+Shift+M',
  notes: 'Ctrl+N',
  todo: 'Ctrl+T',
  eraser: 'Ctrl+Shift+E'
}

export const APP_COMMANDS = ['marker', 'notes', 'todo', 'eraser'] as const satisfies readonly AppCommand[]

const KEYBIND_ORDER = ['save', 'find', 'marker', 'notes', 'todo', 'eraser'] as const

const FALLBACKS: Record<(typeof KEYBIND_ORDER)[number], readonly string[]> = {
  save: ['Ctrl+S', 'Ctrl+Alt+S'],
  find: ['Ctrl+F', 'Ctrl+Shift+F', 'Ctrl+Alt+F'],
  marker: ['Ctrl+Shift+M', 'Ctrl+Alt+M'],
  notes: ['Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Alt+N'],
  todo: ['Ctrl+T', 'Ctrl+Shift+T', 'Ctrl+Alt+T'],
  eraser: ['Ctrl+Shift+E', 'Ctrl+Alt+E']
}

const BINDING = /^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Enter|Space|Tab|Backspace|Delete|Arrow(?:Up|Down|Left|Right))$/

export function normalizeKeybinds(value: unknown): Keybinds {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const used = new Set<string>()
  const result = {} as Keybinds
  for (const key of KEYBIND_ORDER) {
    const stored = typeof data[key] === 'string' && BINDING.test(data[key]) ? data[key] : ''
    const choice = [stored, ...FALLBACKS[key]].find((binding) => binding.length > 0 && !used.has(binding)) ?? FALLBACKS[key][0]
    result[key] = choice
    used.add(choice)
  }
  return result
}

interface KeyInput {
  key: string
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export function acceleratorFromEvent(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null
  const name = keyName(event.code, event.key)
  if (!name) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0) return null
  parts.push(name)
  const binding = parts.join('+')
  return BINDING.test(binding) ? binding : null
}

export function eventMatches(binding: string, input: KeyInput): boolean {
  const parts = binding.split('+')
  const name = parts[parts.length - 1]
  const mods = new Set(parts.slice(0, -1))
  if (mods.has('Ctrl') !== (input.ctrl || input.meta)) return false
  if (mods.has('Alt') !== input.alt) return false
  if (mods.has('Shift') !== input.shift) return false
  return keyName(input.code, input.key) === name
}

function keyName(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code
  if (code === 'Space') return 'Space'
  if (['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) return code
  if (key.length === 1 && /[a-z0-9]/i.test(key)) return key.toUpperCase()
  return null
}
