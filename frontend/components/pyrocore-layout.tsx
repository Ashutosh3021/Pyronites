'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Database,
  Code,
  Settings,
  Key,
  FileText,
  Users,
  BarChart3,
  TrendingUp,
  Menu,
  X,
  LogOut,
} from 'lucide-react'
import { ProjectSwitcher } from '@/components/project-switcher'
import { API_BASE, getStoredProjectName, PROJECT_CHANGE_EVENT, clearStoredProject } from '@/lib/api'

const navItems = [
  { href: '/', icon: BarChart3, label: 'Overview' },
  { href: '/database', icon: Database, label: 'Database' },
  { href: '/sql-editor', icon: Code, label: 'SQL Editor' },
  { href: '/auth', icon: Users, label: 'Authentication' },
  { href: '/api-keys', icon: Key, label: 'API Keys' },
  { href: '/storage', icon: FileText, label: 'Storage' },
  { href: '/analytics', icon: TrendingUp, label: 'Analytics' },
  { href: '/logs', icon: BarChart3, label: 'Logs' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

function AuthGateShell({ slow }: { slow: boolean }) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="hidden lg:flex w-70 flex-col border-r border-border bg-card">
        <div className="px-6 py-5 border-b border-border">
          <div className="h-5 w-28 rounded bg-muted animate-pulse" />
          <div className="h-3 w-20 rounded bg-muted/70 animate-pulse mt-2" />
        </div>
        <div className="px-3 py-4 space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted/50 animate-pulse" />
          ))}
        </div>
      </aside>
      <div className="flex-1 flex flex-col">
        <header className="h-14 lg:h-16 border-b border-border bg-card px-4 flex items-center">
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        </header>
        <main className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">
            {slow ? 'Waking the server… this can take up to a minute on free tier.' : 'Checking session…'}
          </p>
        </main>
      </div>
    </div>
  )
}

export function PyroCoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const [projectLabel, setProjectLabel] = useState<string | null>(null)

  const [authChecked, setAuthChecked] = useState(false)
  const [slowAuth, setSlowAuth] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlowAuth(true)
    }, 2500)

    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          return res.json()
        }
        throw new Error('Not authenticated')
      })
      .then((data) => {
        if (!cancelled && data?.email) {
          setUserEmail(data.email)
        }
        setAuthChecked(true)
      })
      .catch(() => {
        if (!cancelled) router.replace('/login')
      })
      .finally(() => {
        window.clearTimeout(slowTimer)
      })

    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
    }
  }, [router])

  useEffect(() => {
    const sync = () => setProjectLabel(getStoredProjectName())
    sync()
    window.addEventListener(PROJECT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, sync)
  }, [])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const currentPage = navItems.find((item) => item.href === pathname)?.label ?? 'PyroCore'

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Proceed with client-side cleanup even if the request fails
    } finally {
      clearStoredProject()
      setConfirmLogout(false)
      setUserMenuOpen(false)
      setLoggingOut(false)
      router.replace('/login')
    }
  }

  if (!authChecked) {
    return <AuthGateShell slow={slowAuth} />
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside
        className={[
          'bg-card border-r border-border flex-shrink-0 flex flex-col',
          'lg:relative lg:translate-x-0 lg:w-70 lg:z-auto',
          'fixed top-0 left-0 bottom-0 w-72 z-50',
          'transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
        aria-label="Main navigation"
      >
        <div className="h-full flex flex-col overflow-hidden">
          <div className="px-6 py-5 border-b border-border flex-shrink-0 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">PyroCore</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Backend Control</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 -mr-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>

          <div className="px-3 pt-3 pb-1 flex-shrink-0">
            <ProjectSwitcher />
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    'flex items-center gap-3 py-3 text-sm font-medium transition-colors',
                    'border-l-4 pl-3 pr-4',
                    isActive
                      ? 'bg-muted text-accent border-accent'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent',
                  ].join(' ')}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>

          <div className="px-4 py-4 border-t border-border flex-shrink-0 space-y-1 text-xs text-muted-foreground">
            <p>v1.1.66</p>
            <p className="truncate">Project: {projectLabel ?? '—'}</p>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: 'rgba(17,17,17,0.7)' }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 lg:h-16 bg-card border-b border-border px-4 lg:px-6 flex items-center justify-between flex-shrink-0 gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-1 text-foreground hover:bg-muted rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" strokeWidth={2} />
          </button>

          <span className="lg:hidden text-sm font-medium text-foreground truncate flex-1">
            {currentPage}
          </span>
          <div className="hidden lg:block flex-1" />

          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: 'var(--pyro-orange)' }}
            />
            <span className="hidden sm:block text-xs text-muted-foreground">Online</span>
          </div>

          {userEmail && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 py-1.5 border border-border hover:bg-muted transition-colors min-h-[44px]"
                aria-haspopup="listbox"
                aria-expanded={userMenuOpen}
              >
                <span className="hidden sm:block text-xs text-foreground truncate max-w-32">{userEmail}</span>
                <span className="sm:hidden text-xs text-muted-foreground">Account</span>
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setUserMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border shadow-lg min-w-48 overflow-hidden">
                    <button
                      onClick={() => { setConfirmLogout(true); setUserMenuOpen(false) }}
                      className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 min-h-[44px]"
                    >
                      <LogOut className="w-4 h-4" />
                      Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-4 lg:p-6">{children}</div>
        </main>

        {confirmLogout && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
              <div className="flex items-center justify-between p-6 pb-4">
                <h2 className="text-lg font-semibold text-foreground">Log out</h2>
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground px-6 pb-2">
                Are you sure you want to log out of <span className="font-semibold text-foreground">{userEmail}</span>?
              </p>
              <div className="flex gap-3 px-6 pb-6 pt-2">
                <button
                  onClick={() => setConfirmLogout(false)}
                  disabled={loggingOut}
                  className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px] disabled:opacity-70"
                >
                  {loggingOut ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-2" aria-hidden="true" />
                      Logging out…
                    </>
                  ) : 'Log out'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
