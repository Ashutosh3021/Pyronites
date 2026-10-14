'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { OAuthButtons } from '@/components/oauth-buttons'
import { AlertBanner } from '@/components/alert-banner'
import { API_BASE } from '@/lib/api'

/** Fallback copy for when the backend's /auth/oauth/errors map is unreachable. */
const FALLBACK_ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. Nothing was changed.',
  invalid_state: 'That sign-in link expired or was already used. Please try again.',
  invalid_code: 'The sign-in could not be completed. Please try again.',
  provider_unavailable: 'The sign-in provider could not be reached. Please try again.',
  unverified_email: "Your provider account's email is not verified. Verify it, then try again.",
  no_email: 'Your provider account does not expose an email address. Add one and try again.',
  disabled: 'This account has been disabled.',
  unknown_error: 'Sign-in could not be completed. Please try again.',
}

function LoginScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const oauthError = searchParams.get('oauth_error')
  const justReset = searchParams.get('reset') === '1'

  const [errors, setErrors] = useState<Record<string, string>>(FALLBACK_ERRORS)

  // The backend owns this copy so the wording cannot drift between the
  // redirect URL and what the user reads.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/auth/oauth/errors`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.errors) setErrors({ ...FALLBACK_ERRORS, ...body.errors })
      })
      .catch(() => {
        /* keep the built-in copy */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const failure = oauthError ? errors[oauthError] ?? errors.unknown_error : null

  useEffect(() => {
    if (!failure) return
    router.replace('/login')
  }, [failure, router])

  return (
    <>
      <div>
        <h1 className="text-base font-semibold text-foreground">PyroCore</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Sign in to your dashboard</p>
      </div>

      {justReset && (
        <AlertBanner variant="success" message="Password updated. You can log in now." />
      )}

      {failure && <AlertBanner variant="error" message={failure} />}

      <OAuthButtons />

      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Signing in with Google or GitHub creates your account and a starter project on
          first use. If you already signed up with an email and password, use the same email
          address and your existing projects will be waiting.
        </p>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        <Link href="/terms" className="hover:underline" style={{ color: 'var(--pyro-orange)' }}>
          Terms
        </Link>
        <span className="mx-2 text-border">·</span>
        <Link href="/privacy" className="hover:underline" style={{ color: 'var(--pyro-orange)' }}>
          Privacy
        </Link>
      </p>
    </>
  )
}

export default function LoginPage() {
  return (
    <AuthShell width="sm">
      <div className="p-8 space-y-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <LoginScreen />
        </Suspense>
      </div>
    </AuthShell>
  )
}