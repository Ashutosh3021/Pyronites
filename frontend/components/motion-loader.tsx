'use client'

import dynamic from 'next/dynamic'

/**
 * The motion engine carries GSAP and Lenis. Neither is needed for the first
 * paint, and the dashboard's LCP is text that must not wait for an animation
 * library, so the engine loads after hydration.
 *
 * `ssr: false` is not allowed in a Server Component, so the lazy boundary
 * lives here instead of in the layout.
 */
const Motion = dynamic(() => import('@/components/motion').then((m) => m.Motion), {
  ssr: false,
})

export function MotionLoader() {
  return <Motion />
}
