'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'
import { PasswordStrength } from '@/components/password-strength'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const confirmMismatch = confirm.length > 0 && confirm !== password

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!token) {
      setError('This reset link is missing a token. Request a new link from the login page.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (res.ok) {
        router.push('/login?reset=1')
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body?.message ?? 'Could not reset password. The link may be invalid or expired.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--error)' }}>
          This reset link is invalid. Request a new one from the login page.
        </p>
        <Link href="/forgot-password" className="text-sm font-medium hover:underline" style={{ color: 'var(--pyro-orange)' }}>
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-foreground">
          New password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2 pr-10 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent min-h-[44px] font-mono"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-0 top-0 bottom-0 px-3 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center min-w-[44px]"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="block text-sm font-medium text-foreground">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          className={`w-full px-3 py-2 bg-background border text-sm text-foreground placeholder-muted-foreground focus:outline-none min-h-[44px] font-mono ${
            confirmMismatch ? 'border-error focus:border-error' : 'border-border focus:border-accent'
          }`}
        />
        {confirmMismatch && (
          <p className="text-xs" style={{ color: 'var(--error)' }}>Passwords don&apos;t match</p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading || confirmMismatch}
        className="w-full btn-primary min-h-[44px] flex items-center justify-center gap-2"
      >
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <AuthShell width="sm">
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-base font-semibold text-foreground">PyroCore</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Choose a new password</p>
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
        <p className="text-sm text-muted-foreground text-center">
          <Link href="/login" className="font-medium hover:underline" style={{ color: 'var(--pyro-orange)' }}>
            Back to log in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
