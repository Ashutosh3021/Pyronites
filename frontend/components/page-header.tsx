import type { ReactNode } from 'react'

/**
 * The page header every dashboard screen uses.
 *
 * One title treatment across nine pages: display type on the left, the one
 * action that belongs to this page on the right, a hairline seam underneath.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Small uppercase label above the title. Only where it carries meaning. */
  meta?: string
}) {
  return (
    <header className="mb-8 lg:mb-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b border-seam pb-6">
      <div className="min-w-0">
        {meta && <p className="label mb-3">{meta}</p>}
        <h1 className="display text-[clamp(1.9rem,1.25rem+2.1vw,2.9rem)] break-words">{title}</h1>
        {description && (
          <p className="mt-3.5 text-[13.5px] leading-relaxed text-ink-muted max-w-[64ch]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </header>
  )
}
