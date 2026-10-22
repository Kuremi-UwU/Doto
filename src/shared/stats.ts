import type { ModuleInstance, NoteContent } from './types'

const MEDIA_NODES = new Set(['image', 'youtube', 'localVideo', 'table', 'horizontalRule'])

export function openTasksIn(modules: ModuleInstance[]): number {
  return modules.reduce((count, module) => count + (module.kind === 'todo' ? module.todos.filter((todo) => !todo.done).length : 0), 0)
}

/** Text, a picture, a video, or a table. An empty paragraph is not information. */
export function contentHasInformation(content: NoteContent | null): boolean {
  return nodeHasInformation(content)
}

/** A notes or to-do window the user has actually put something in, including a renamed title. */
export function moduleHasInformation(module: ModuleInstance): boolean {
  const fallback = module.kind === 'todo' ? 'To-do' : 'Notes'
  if (module.title.trim() !== fallback) return true
  if (module.todos.some((todo) => todo.text.trim().length > 0)) return true
  return contentHasInformation(module.content)
}

/** A tab worth keeping in the trash. A blank Untitled page is not. */
export function tabHasInformation(tab: { title: string; content: NoteContent | null; modules: ModuleInstance[]; ink?: unknown[] }): boolean {
  if (tab.title.trim() !== 'Untitled') return true
  if (tab.ink && tab.ink.length > 0) return true
  if (contentHasInformation(tab.content)) return true
  return tab.modules.some(moduleHasInformation)
}

function nodeHasInformation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if ('text' in value && typeof value.text === 'string' && value.text.trim().length > 0) return true
  if ('type' in value && typeof value.type === 'string' && MEDIA_NODES.has(value.type)) return true
  if ('content' in value && Array.isArray(value.content)) return value.content.some(nodeHasInformation)
  return false
}

export function wordsIn(content: NoteContent | null): number {
  const text = plainText(content).replace(/\s+/g, ' ').trim()
  return text ? text.split(' ').length : 0
}

function plainText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if ('text' in value && typeof value.text === 'string') return value.text
  if ('content' in value && Array.isArray(value.content)) return value.content.map((item) => plainText(item)).join(' ')
  return ''
}
