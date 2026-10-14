/**
 * Shared empty state.
 *
 * Replaces the nine one-line "No X yet." strings the app had accumulated. Each
 * of those was a dead end: text telling you something is missing, with no
 * obvious action. An empty state that does not offer the next step is just a
 * slightly prettier error.
 *
 * Sizing stays at or below the surrounding text so an empty list never shouts
 * louder than real content.
 */

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  /** The one action worth taking. Rendered as a real button, not a link. */
  action?: { label: string; onClick: () => void; disabled?: boolean }
  /** Secondary, lower-emphasis path (e.g. "or paste SQL"). */
  secondaryAction?: { label: string; onClick: () => void }
  className?: string
  /** Compact mode drops the icon — for narrow sidebars. */
  compact?: boolean
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-3 py-6' : 'gap-2 px-4 py-10',
        className
      )}
    >
      {Icon && !compact && (
        <Icon className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
      )}

      <p
        className={cn(
          'font-medium text-foreground',
          compact ? 'text-xs' : 'text-sm'
        )}
      >
        {title}
      </p>

      {description && (
        <p
          className={cn(
            'text-muted-foreground leading-relaxed max-w-sm',
            compact ? 'text-xs' : 'text-xs'
          )}
        >
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className={cn('flex flex-wrap items-center justify-center', compact ? 'gap-2 pt-1' : 'gap-3 pt-2')}>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(
                'inline-flex items-center justify-center border border-transparent px-3 py-1.5',
                'text-xs font-medium transition-colors',
                'bg-[var(--pyro-orange)] text-white',
                'hover:bg-[var(--pyro-orange-hover)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                compact ? 'min-h-[32px]' : 'min-h-[36px]'
              )}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className={cn(
                'text-xs font-medium transition-colors hover:underline',
                compact ? 'min-h-[32px]' : 'min-h-[36px]',
                'inline-flex items-center'
              )}
              style={{ color: 'var(--pyro-orange)' }}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}