'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const justReset = searchParams.get('reset') === '1'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })

      if (res.ok) {
        router.push('/')
      } else {
        setError('Incorrect email or password.')
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div>
        <h1 className="text-base font-semibold text-foreground">PyroCore</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Sign in to your account</p>
      </div>

      {justReset && (
        <p className="text-sm" style={{ color: 'var(--success)' }}>
          Password updated. You can log in now.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
            {error}
          </p>
        )}

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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium hover:underline"
              style={{ color: 'var(--pyro-orange)' }}
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
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
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full btn-primary min-h-[44px] flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : 'Log in'}
        </button>
      </form>

      <p className="text-sm text-muted-foreground text-center">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="font-medium hover:underline"
          style={{ color: 'var(--pyro-orange)' }}
        >
          Sign up
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
          <LoginForm />
        </Suspense>
      </div>
    </AuthShell>
  )
}
