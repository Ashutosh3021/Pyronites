'use client'

/**
 * Minimal hover/focus tooltip.
 *
 * Exists because the OAuth provider buttons have to explain *why* a provider is
 * unavailable, and a disabled button swallows pointer events — so the trigger
 * stays focusable via `aria-disabled` and this wrapper carries the hover.
 */

import { useId, useState } from 'react'

interface TooltipProps {
  label: string
  children: React.ReactNode
  /** Show below the trigger (default) or above it. */
  side?: 'bottom' | 'top'
}

export function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  const position =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : 'top-full left-1/2 -translate-x-1/2 mt-2'

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute ${position} z-50 max-w-64 px-3 py-2 text-xs leading-snug text-foreground bg-popover border border-border whitespace-normal`}
        >
          {label}
        </span>
      )}
    </span>
  )
}