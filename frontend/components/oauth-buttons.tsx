'use client'

/**
 * OAuth sign-in buttons.
 *
 * Every provider the backend knows about is rendered. A provider that is not
 * configured on the server still gets a button so the user can see it exists,
 * but it is visibly inert and explains why on hover/focus.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'

import { AlertBanner } from '@/components/alert-banner'
import { GitHubMark, GoogleMark } from '@/components/oauth-marks'
import { Tooltip } from '@/components/tooltip'
import { API_BASE } from '@/lib/api'

export interface OAuthProvider {
  id: string
  name: string
  configured: boolean
}

const MARKS: Record<string, React.ComponentType<{ className?: string }>> = {
  google: GoogleMark,
  github: GitHubMark,
}

export function OAuthButtons() {
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(`${API_BASE}/auth/oauth/providers`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`providers returned ${res.status}`)
        return res.json()
      })
      .then((body) => {
        if (cancelled) return
        const list = Array.isArray(body?.providers) ? body.providers : []
        setProviders(list)
        // Nothing the user can click is a broken state, not an empty one.
        if (list.length === 0) setUnreachable(true)
      })
      .catch(() => {
        if (!cancelled) setUnreachable(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback((id: string) => {
    // A real navigation, not fetch(): the backend has to set its own cookie on
    // its own origin, then hand off to the provider.
    window.location.href = `${API_BASE}/auth/oauth/${id}/start`
  }, [])

  if (unreachable) {
    return (
      <AlertBanner
        variant="error"
        message="Sign-in is unavailable right now. Check that the backend is running and try again."
      />
    )
  }

  if (providers === null) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading sign-in options">
        {[0, 1].map((i) => (
          <div key={i} className="h-12 w-full bg-muted/60 animate-pulse border border-seam" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => {
        const Mark = MARKS[provider.id]
        const disabled = !provider.configured || busy !== null

        const button = (
          <button
            type="button"
            // aria-disabled rather than `disabled` keeps the button focusable,
            // so keyboard users can still read the explanation in the tooltip.
            aria-disabled={disabled}
            onClick={() => {
              if (disabled) return
              setBusy(provider.id)
              signIn(provider.id)
            }}
            className={[
              'w-full flex items-center justify-center gap-3 px-4 py-3 text-[13.5px] font-medium',
              'border transition-colors min-h-[48px]',
              provider.configured
                ? 'border-seam bg-plate text-ink hover:border-accent hover:bg-plate-raised'
                : 'border-seam/60 bg-plate/40 text-ink-faint cursor-not-allowed',
              busy !== null ? 'opacity-70 pointer-events-none' : '',
            ].join(' ')}
          >
            {busy === provider.id ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : Mark ? (
              <Mark className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
            )}
            <span>Continue with {provider.name}</span>
          </button>
        )

        if (provider.configured) {
          return <div key={provider.id}>{button}</div>
        }

        return (
          <Tooltip
            key={provider.id}
            label={`${provider.name} sign-in is not configured on this server. An administrator needs to set its client id and secret.`}
          >
            {button}
          </Tooltip>
        )
      })}
    </div>
  )
}