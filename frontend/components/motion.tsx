'use client'

import { Engine } from '@/engine/next'
import { setupMotion } from '@/motion/setup'

/**
 * Mounted once, as the last child of <body>. React runs child effects first,
 * so page components register with the engine before it boots.
 */
export function Motion() {
  return <Engine setup={setupMotion} />
}
