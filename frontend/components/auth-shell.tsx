import { Core } from '@/components/core'

/**
 * Shared wrapper for the pre-dashboard screens.
 *
 * The split variant is the site's front door: the brand panel on the left
 * carries the statement and the Core, the panel on the right carries the
 * form. The panel variant is the narrow, centred form used by the project
 * wizard, where a brand panel would get in the way.
 */

interface AuthShellProps {
  children: React.ReactNode
  /** 'split' = brand panel + form. 'panel' = a single centred form card. */
  variant?: 'split' | 'panel'
  /** Form width — 'sm' = ~400px (login), 'md' = ~560px (wizard) */
  width?: 'sm' | 'md'
}

export function AuthShell({ children, variant = 'split', width = 'sm' }: AuthShellProps) {
  if (variant === 'panel') {
    const maxW = width === 'md' ? 'max-w-[560px]' : 'max-w-[400px]'
    return (
      <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 sm:p-6">
        <div className={`w-full ${maxW} plate`}>{children}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background grid grid-cols-1 lg:grid-cols-12">
      {/* Brand panel */}
      <aside className="lg:col-span-7 relative overflow-hidden border-b lg:border-b-0 lg:border-r border-seam px-6 sm:px-10 lg:px-14 py-10 lg:py-14 flex flex-col justify-between">
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <Core size={30} />
            <span className="wordmark text-[17px] text-ink">PyroCore</span>
          </div>

          <h1 className="display mt-10 lg:mt-16 text-[clamp(2.25rem,1.2rem+3.6vw,4.25rem)] max-w-[13ch]">
            Your backend, under your control.
          </h1>

          <p className="mt-6 text-[15px] leading-relaxed text-ink-muted max-w-[46ch]">
            Tables, SQL, users, API keys, file storage and logs, served by one container you run
            yourself. The data never leaves the machine unless you point it at object storage.
          </p>

          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
            {[
              ['Deployment', 'One container, one port'],
              ['Storage', 'SQLite, synced to S3'],
              ['Access', 'REST and GraphQL style routes'],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="label">{term}</dt>
                <dd className="data mt-1.5 text-[12.5px] text-ink-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* The Core, dormant at the door, warming once the backend answers. */}
        <div className="relative mt-12 lg:mt-0 flex justify-end -mb-6 -mr-6 lg:-mb-14 lg:-mr-14 pointer-events-none">
          <Core size={260} className="lg:size-[320px] opacity-90" />
        </div>
      </aside>

      {/* Form panel */}
      <section className="lg:col-span-5 flex items-center justify-center px-6 sm:px-10 py-12 lg:py-16">
        <div className="w-full max-w-[380px]">{children}</div>
      </section>
    </div>
  )
}
