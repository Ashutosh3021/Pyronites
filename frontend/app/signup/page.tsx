'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
)
import { AuthShell } from '@/components/auth-shell'
import { PasswordStrength } from '@/components/password-strength'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function SignUpPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const confirmMismatch = confirm.length > 0 && confirm !== password

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Signup auto-logs the user in, so include credentials to capture the cookie.
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (res.ok) {
        // Account created and session established — continue to project wizard.
        router.push('/new-project')
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body?.message ?? 'Could not create account. Try again.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell width="sm">
      <div className="p-8 space-y-6">

        {/* Wordmark */}
        <div>
          <h1 className="text-base font-semibold text-foreground">PyroCore</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>

          {/* Inline error */}
          {error && (
            <p className="text-sm" style={{ color: 'var(--error)' }}>
              {error}
            </p>
          )}

          {/* Email */}
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

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
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
            {/* Live strength meter */}
            <PasswordStrength password={password} />
          </div>

          {/* Confirm password */}
          <div className="space-y-1.5">
            <label htmlFor="confirm" className="block text-sm font-medium text-foreground">
              Confirm password
            </label>
            <div className="relative">
              <input
                id="confirm"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className={`w-full px-3 py-2 pr-10 bg-background border text-sm text-foreground placeholder-muted-foreground focus:outline-none min-h-[44px] font-mono ${
                  confirmMismatch
                    ? 'border-error focus:border-error'
                    : 'border-border focus:border-accent'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-0 top-0 bottom-0 px-3 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center min-w-[44px]"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmMismatch && (
              <p className="text-xs" style={{ color: 'var(--error)' }}>
                Passwords don&apos;t match
              </p>
            )}
          </div>

          {/* Primary CTA */}
          <button
            type="submit"
            disabled={loading || confirmMismatch}
            className="w-full btn-primary min-h-[44px] flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating account…
              </>
            ) : 'Create account'}
          </button>

          {/* Legal small print */}
          <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
            By signing up, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-foreground transition-colors">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            .
          </p>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* GitHub */}
        <button
          type="button"
          className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          <GitHubIcon />
          Continue with GitHub
        </button>

        {/* Switch to log in */}
        <p className="text-sm text-muted-foreground text-center">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium hover:underline"
            style={{ color: 'var(--pyro-orange)' }}
          >
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
