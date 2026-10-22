import { useRef, useState } from 'react'

interface InlineInputProps {
  initialValue: string
  ariaLabel: string
  className?: string
  maxLength?: number
  onCommit: (value: string) => void
  onCancel: () => void
}

/** A text field that commits on Enter or blur and cancels on Escape. */
export default function InlineInput({
  initialValue,
  ariaLabel,
  className,
  maxLength,
  onCommit,
  onCancel
}: InlineInputProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  // Removing a focused input can fire one last blur after Enter or Escape already settled it.
  const settled = useRef(false)

  const settle = (commit: boolean): void => {
    if (settled.current) return
    settled.current = true
    if (commit) onCommit(value)
    else onCancel()
  }

  return (
    <input
      className={className}
      aria-label={ariaLabel}
      value={value}
      maxLength={maxLength}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          settle(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          settle(false)
        }
      }}
    />
  )
}
