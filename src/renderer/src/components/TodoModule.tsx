import { useRef, useState } from 'react'
import { Check, GripVertical, X } from 'lucide-react'
import type { TodoItem } from '../../../shared/types'
import { cx } from '../cx'
import { updateTodos, useDoto } from '../store'
import { askConfirm } from './ConfirmDialog'
import InkLayer from './InkLayer'
import InlineInput from './InlineInput'

const NO_TODOS: TodoItem[] = []
const MAX_TODO_LENGTH = 2000
const DRAG_TYPE = 'application/x-doto-todo'

export function TodoMeta({ moduleId }: { moduleId: string }): React.JSX.Element | null {
  const todos = useDoto((state) => state.tab?.modules.find((module) => module.id === moduleId)?.todos ?? NO_TODOS)
  const done = todos.filter((todo) => todo.done).length
  if (todos.length === 0) return null

  return (
    <span className="module-window__meta">
      {done} of {todos.length} done
    </span>
  )
}

export default function TodoModule({ moduleId }: { moduleId: string }): React.JSX.Element {
  const todos = useDoto((state) => state.tab?.modules.find((module) => module.id === moduleId)?.todos ?? NO_TODOS)
  const pinned = useDoto((state) => state.tab?.modules.find((module) => module.id === moduleId)?.pinned ?? false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const change = (update: (items: TodoItem[]) => TodoItem[]): void => updateTodos(moduleId, update)

  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    change((items) => [...items, { id: crypto.randomUUID(), text, done: false }])
    setDraft('')
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }))
  }

  const endDrag = (): void => {
    setDragId(null)
    setDropIndex(null)
  }

  return (
    <div className="todo">
      <InkLayer surface={`module:${moduleId}`} />
      {todos.length === 0 ? (
        <p className="todo__empty">No tasks yet. Add your first one below.</p>
      ) : (
        <ul
          className="todo__list"
          ref={listRef}
          onDragOver={(event) => {
            if (!dragId) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            if (event.target === event.currentTarget) setDropIndex(todos.length)
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (dragId !== null && dropIndex !== null) change((items) => moveItem(items, dragId, dropIndex))
            endDrag()
          }}
        >
          {todos.map((item, index) => (
            <li
              key={item.id}
              className={cx(
                'todo__item',
                item.done && 'is-done',
                dragId === item.id && 'is-dragging',
                dragId !== null && dropIndex === index && 'drop-before',
                dragId !== null && dropIndex === todos.length && index === todos.length - 1 && 'drop-after'
              )}
              draggable={!pinned && editingId !== item.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(DRAG_TYPE, item.id)
                setDragId(item.id)
              }}
              onDragOver={(event) => {
                if (!dragId) return
                const box = event.currentTarget.getBoundingClientRect()
                setDropIndex(event.clientY < box.top + box.height / 2 ? index : index + 1)
              }}
              onDragEnd={endDrag}
            >
              <span className="todo__grip" aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={item.text}
                className={cx('todo__check', item.done && 'is-checked')}
                disabled={pinned}
                onClick={() => change((items) => items.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)))}
              >
                {item.done && <Check size={12} strokeWidth={3} />}
              </button>
              {editingId === item.id ? (
                <InlineInput
                  className="todo__edit"
                  ariaLabel="Edit task"
                  initialValue={item.text}
                  maxLength={MAX_TODO_LENGTH}
                  onCommit={(value) => {
                    const clean = value.trim()
                    if (clean) {
                      change((items) => items.map((entry) => (entry.id === item.id && entry.text !== clean ? { ...entry, text: clean } : entry)))
                    }
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span className="todo__text" title={pinned ? undefined : 'Double-click to edit'} onDoubleClick={() => { if (!pinned) setEditingId(item.id) }}>
                  {item.text}
                </span>
              )}
              {!pinned && <button
                type="button"
                className="todo__delete"
                aria-label={`Delete ${item.text}`}
                title="Delete task"
                onClick={() =>
                  askConfirm({
                    title: 'Delete this task?',
                    message: item.text,
                    confirmLabel: 'Delete',
                    run: () => change((items) => items.filter((entry) => entry.id !== item.id))
                  })
                }
              >
                <X size={14} />
              </button>}
            </li>
          ))}
        </ul>
      )}
      {!pinned && (
        <form
          className="todo__composer"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <input
            className="todo__input"
            aria-label="New task"
            placeholder="Add a task and press Enter"
            value={draft}
            maxLength={MAX_TODO_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
      )}
    </div>
  )
}

function moveItem(items: TodoItem[], id: string, toIndex: number): TodoItem[] {
  const from = items.findIndex((item) => item.id === id)
  const target = toIndex > from ? toIndex - 1 : toIndex
  if (from === -1 || target === from) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}
