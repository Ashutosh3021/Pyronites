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
} from 'lucide-react'
import { ProjectSwitcher } from '@/components/project-switcher'
import { API_BASE, getStoredProjectName, PROJECT_CHANGE_EVENT } from '@/lib/api'

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

  useEffect(() => {
    let cancelled = false
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlowAuth(true)
    }, 2500)

    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setAuthChecked(true)
        } else {
          router.replace('/login')
        }
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
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
