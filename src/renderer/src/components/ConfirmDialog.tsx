import { useEffect, useState } from 'react'

interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  run: () => void
}

let opener: ((request: ConfirmRequest) => void) | null = null

/** Asks before a note, task, or window is removed. */
export function askConfirm(request: ConfirmRequest): void {
  opener?.(request)
}

export default function ConfirmDialog(): React.JSX.Element | null {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    opener = setRequest
    return () => {
      opener = null
    }
  }, [])

  useEffect(() => {
    if (!request) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setRequest(null)
        return
      }
      if (event.key !== 'Enter' || event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const run = request.run
      setRequest(null)
      run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request])

  if (!request) return null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setRequest(null)
      }}
    >
      <form
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onSubmit={(event) => {
          event.preventDefault()
          const run = request.run
          setRequest(null)
          run()
        }}
      >
        <h2 id="confirm-title" className="dialog__title">
          {request.title}
        </h2>
        <p className="dialog__hint">{request.message}</p>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => setRequest(null)}>
            Cancel
          </button>
          <button type="submit" className="button button--danger" autoFocus>
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
