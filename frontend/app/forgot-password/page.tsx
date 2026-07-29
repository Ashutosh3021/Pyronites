'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      if (res.status === 429) {
        setError('Too many requests. Please try again later.')
        return
      }
      // Always show success for 2xx; backend never reveals if email exists
      if (res.ok) {
        setDone(true)
        return
      }
      setError('Something went wrong. Please try again.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell width="sm">
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-base font-semibold text-foreground">PyroCore</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Reset your password</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              If an account exists for that email, we sent password reset instructions.
              Check your inbox (and spam folder).
            </p>
            <Link
              href="/login"
              className="inline-block text-sm font-medium hover:underline"
              style={{ color: 'var(--pyro-orange)' }}
            >
              Back to log in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error && (
              <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
                {error}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Enter the email for your account. We will send a link to choose a new password.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent min-h-[44px]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary min-h-[44px] flex items-center justify-center gap-2"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-sm text-muted-foreground text-center">
              <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--pyro-orange)' }}>
                Back to log in
              </Link>
            </p>
          </form>
        )}
      </div>
    </AuthShell>
  )
}
