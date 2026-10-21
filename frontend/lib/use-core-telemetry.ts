'use client'

import { useEffect } from 'react'
import { API_BASE, getStoredProjectId, PROJECT_CHANGE_EVENT } from '@/lib/api'
import { reportCoreRate } from '@/motion/core'

type MetricsPoint = { requests?: number }

type MetricsBody = {
  points?: MetricsPoint[]
}

/**
 * Feeds the core with the backend's real request rate.
 *
 * The rate is the average of the last five one-minute buckets, so the number
 * on screen moves with actual traffic instead of drifting on a timer. Runs
 * once per page of the shell, and again whenever the project changes.
 */
export function useCoreTelemetry(enabled = true) {
  useEffect(() => {
    if (!enabled) return

    let timer: number | undefined

    const load = async () => {
      const id = getStoredProjectId()
      if (!id) return
      try {
        const res = await fetch(
          `${API_BASE}/api/projects/${encodeURIComponent(id)}/metrics?range=1h`,
          { credentials: 'include' },
        )
        if (!res.ok) return
        const body = (await res.json()) as MetricsBody
        const points = Array.isArray(body?.points) ? body.points : []
        const recent = points.slice(-5)
        if (!recent.length) {
          reportCoreRate(0)
          return
        }
        const sum = recent.reduce((acc, p) => acc + (p.requests ?? 0), 0)
        reportCoreRate(sum / recent.length)
      } catch {
        // The core keeps the last reading it had. A dropped poll is not a
        // reason to lie about the machine's temperature.
      }
    }

    void load()
    timer = window.setInterval(load, 20000)

    const onProjectChange = () => {
      void load()
    }
    window.addEventListener(PROJECT_CHANGE_EVENT, onProjectChange)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener(PROJECT_CHANGE_EVENT, onProjectChange)
    }
  }, [enabled])
}
