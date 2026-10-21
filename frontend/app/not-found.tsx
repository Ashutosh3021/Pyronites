'use client'

import Link from 'next/link'
import { Core } from '@/components/core'
import { ArrowLeft } from 'lucide-react'

/**
 * The 404 carries the concept: the vessel is intact, the path through it is
 * not. The core is cold, because nothing is running on that address.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <main id="main" className="w-full max-w-[920px] grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
        <div className="md:col-span-7">
          <p className="label">Error 404</p>
          <h1 className="display mt-5 text-[clamp(2.5rem,1.4rem+4vw,4.5rem)] max-w-[12ch]">
            No route through the rock.
          </h1>
          <p className="mt-6 text-[15px] leading-relaxed text-ink-muted max-w-[46ch]">
            The address you asked for is not part of this container. It may have been renamed, or
            the project behind it may have been deleted.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/"
              className="ignite inline-flex items-center gap-2 px-5 py-3 text-[13.5px] font-medium"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to the dashboard
            </Link>
            <Link href="/logs" className="link-quiet text-[13px]">
              Check the logs
            </Link>
          </div>
        </div>

        <div className="md:col-span-5 flex justify-center md:justify-end">
          <Core size={240} className="opacity-70" />
        </div>
      </main>
    </div>
  )
}
