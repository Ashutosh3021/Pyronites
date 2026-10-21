'use client'

import React, { useState, useEffect, useRef } from 'react'
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
import { CoreMark } from '@/components/brand'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCoreTelemetry } from '@/lib/use-core-telemetry'
import {
  API_BASE,
  getStoredProjectName,
  getStoredProjectId,
  setStoredProject,
  fetchProjects,
  fetchCurrentProjectId,
  isDefaultProject,
  PROJECT_CHANGE_EVENT,
  clearStoredProject,
} from '@/lib/api'

const navItems = [
  { href: '/', icon: BarChart3, label: 'Overview' },
  { href: '/database', icon: Database, label: 'Database' },
  { href: '/sql-editor', icon: Code, label: 'SQL editor' },
  { href: '/auth', icon: Users, label: 'Authentication' },
  { href: '/api-keys', icon: Key, label: 'API keys' },
  { href: '/storage', icon: FileText, label: 'Storage' },
  { href: '/analytics', icon: TrendingUp, label: 'Analytics' },
  { href: '/logs', icon: BarChart3, label: 'Logs' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

/**
 * The first paint for an anonymous visitor. It is a real block of content, not
 * a spinner: one heading and enough to orient, inside the page's own main
 * landmark.
 */
function AuthGateShell({ slow }: { slow: boolean }) {
  return (
    <div className="max-w-[52ch]">
      <p className="label">Signing in</p>
      <h1 className="display mt-4 text-[clamp(1.9rem,1.3rem+2vw,2.6rem)]">
        Checking your session.
      </h1>

      <p className="mt-5 text-[14px] leading-relaxed text-ink-muted">
        PyroCore is a self-hosted backend. Tables, SQL, users, API keys, file storage and logs all
        live in one container you run yourself, and this panel is how you drive it.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
        {slow
          ? 'The server is slow to answer. On the free tier a cold container can take a minute to wake up.'
          : 'One request to the server tells us whether you are still signed in.'}
      </p>

      <div className="mt-8 h-px w-full bg-seam overflow-hidden">
        <div className="h-full w-1/3 bg-accent animate-pulse" />
      </div>

      <Link href="/login" className="link mt-6 inline-block text-[13px]">
        Skip to the sign-in screen
      </Link>
    </div>
  )
}

// Auth probe that survives transient failures (Render free-tier cold start:
// 5xx from the load balancer, dropped sockets while the container boots).
// 4xx — notably 401 = genuinely logged out — returns immediately so expired
// sessions still redirect to /login without delay.
async function fetchAuthWithRetry(url: string, attempts = 3): Promise<Response> {
  let last: Response | null = null
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, i * 1500))
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (res.status < 500) return res
      last = res
    } catch {
      last = null // network error — keep retrying
    }
  }
  if (last) return last
  throw new Error('auth unreachable')
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
  const drawerRef = useRef<HTMLDivElement>(null)

  useCoreTelemetry(authChecked)

  useEffect(() => {
    let cancelled = false
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlowAuth(true)
    }, 2500)

    fetchAuthWithRetry(`${API_BASE}/auth/me`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          return res.json()
        }
        throw new Error('Not authenticated')
      })
      .then(async (data) => {
        if (!cancelled && data?.email) {
          setUserEmail(data.email)
        }
        // H1: resolve the active project BEFORE children mount. Pages call
        // apiUrl() synchronously on mount — without this hydration they'd hit
        // the legacy unscoped plane (wrong/Default DB) on a cold load.
        //
        // The stored id is validated on EVERY authenticated load, not just when
        // localStorage is empty. A stored id goes stale when the user signs into
        // a different account, or when a redeploy restores the database from S3
        // with fresh ids. Because apiUrl() rewrites every data route to
        // /api/projects/{id}/..., one stale id 404s the entire dashboard and
        // the user sees "Could not load overview. Is the backend running?".
        if (!cancelled) {
          try {
            const storedId = getStoredProjectId()
            const list = await fetchProjects()
            const stillValid =
              storedId != null &&
              list.some((p) => p.id === storedId || p.project_id === storedId)

            if (!stillValid) {
              const serverId: string | null = data?.last_project_id ?? (await fetchCurrentProjectId())
              const serverMatch =
                serverId && list.find((p) => p.id === serverId || p.project_id === serverId)
              const chosen = serverMatch ?? list.find(isDefaultProject) ?? list[0]
              if (chosen) setStoredProject({ id: chosen.id, name: chosen.name })
              else clearStoredProject()
            }
          } catch {
            // Non-fatal: pages fall back to the server's default resolution.
          }
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
    setUserMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // The drawer is a modal surface on small screens: Escape closes it and focus
  // moves into it so a keyboard user is not left behind on the page.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>('a[href], button')?.focus()
    }, 60)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [sidebarOpen])

  const currentPage = navItems.find((item) => item.href === pathname)?.label ?? 'Overview'

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

  const railContents = (
    <>
      <div className="px-5 pt-6 pb-5 flex items-center gap-3 shrink-0">
        <Link href="/" className="flex items-center gap-3 group" aria-label="PyroCore home">
          <span className="transition-transform duration-500 ease-out group-hover:scale-110">
            <CoreMark size={26} />
          </span>
          <span className="wordmark text-[15px] text-ink transition-colors group-hover:text-accent">
            PyroCore
          </span>
        </Link>
      </div>

      <div className="px-4 pb-4 shrink-0">
        <ProjectSwitcher />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'seam-open flex items-center gap-3 py-2.5 pl-4 pr-3 text-[13.5px] transition-colors',
                    isActive
                      ? 'bg-plate text-ink font-medium hover:bg-plate-raised'
                      : 'text-ink-muted hover:text-ink hover:bg-plate/60',
                  ].join(' ')}
                >
                  <Icon
                    className="w-[15px] h-[15px] flex-shrink-0"
                    strokeWidth={1.75}
                    style={isActive ? { color: 'var(--accent)' } : undefined}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="px-5 py-4 border-t border-seam shrink-0 space-y-1.5">
        <p className="label">Build</p>
        <p className="data text-xs text-ink-muted">v1.1.66</p>
        <p className="data text-xs text-ink-faint truncate" title={projectLabel ?? undefined}>
          {projectLabel ?? 'No project'}
        </p>
      </div>
    </>
  )

  if (!authChecked) {
    // The shell renders either way: the rail, the header and the navigation are
    // in the served HTML, so a crawler sees the structure of the product and
    // the first paint is already the product's frame. Only the content region
    // waits for the session check.
    return (
      <div className="min-h-screen bg-background">
        <aside
          className="hidden lg:flex fixed inset-y-0 left-0 w-[264px] flex-col bg-rail border-r border-seam z-40"
          aria-label="Main navigation"
        >
          {railContents}
        </aside>
        <div className="lg:pl-[264px] flex flex-col min-h-screen">
          <header className="lit-edge sticky top-0 z-30 h-14 bg-background/92 backdrop-blur-sm border-b border-seam px-4 lg:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 -ml-1 text-ink-muted hover:text-ink transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" strokeWidth={2} />
              </button>
              <span className="label truncate">Overview</span>
            </div>
            <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
              <div className="hidden sm:flex items-center gap-2.5">
                <span
                  className="w-[7px] h-[7px] rotate-45 flex-shrink-0"
                  style={{ background: 'var(--accent)' }}
                  aria-hidden="true"
                />
                <span className="label">Core</span>
                <span className="data text-xs text-ink-muted">
                  <span data-core-rate>0</span> req/min
                </span>
              </div>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex-1 px-4 sm:px-6 lg:px-10 py-8 lg:py-12">
            <div className="mx-auto w-full max-w-[1400px]">
              <AuthGateShell slow={slowAuth} />
            </div>
          </main>
        </div>
      </div>
    )
  }



  return (
    <div className="min-h-screen bg-background">
      {/* Rail (desktop) */}
      <aside
        className="hidden lg:flex fixed inset-y-0 left-0 w-[264px] flex-col bg-rail border-r border-seam z-40"
        aria-label="Main navigation"
      >
        {railContents}
      </aside>

      {/* Rail (mobile drawer) */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 w-[86%] max-w-[320px] flex flex-col bg-rail border-r border-seam overflow-y-auto"
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <span className="label">Navigate</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 -mr-1 text-ink-muted hover:text-ink transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>
            {railContents}
          </div>
        </div>
      )}

      <div className="lg:pl-[264px] flex flex-col min-h-screen">
        <header className="lit-edge sticky top-0 z-30 h-14 bg-background/92 backdrop-blur-sm border-b border-seam px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-1 text-ink-muted hover:text-ink transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" strokeWidth={2} />
            </button>
            <span className="label truncate">{currentPage}</span>
          </div>

          <div className="flex items-center gap-3 sm:gap-5 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-2.5" title="Backend request rate over the last five minutes">
              <span
                className="w-[7px] h-[7px] rotate-45 flex-shrink-0"
                style={{ background: 'var(--accent)' }}
                aria-hidden="true"
              />
              <span className="label">Core</span>
              <span className="data text-xs text-ink-muted">
                <span data-core-rate>0</span> req/min
              </span>
              <span className="data text-xs text-accent" data-core-state>
                IDLE
              </span>
            </div>

            {userEmail && (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="seam-open flex items-center gap-2 px-3 py-2 border border-seam hover:border-seam-strong hover:bg-plate transition-colors min-h-[40px]"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                >
                  <span className="hidden sm:block data text-xs text-ink truncate max-w-40">{userEmail}</span>
                  <span className="sm:hidden label">Account</span>
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1 z-50 bg-popover border border-seam min-w-52"
                    >
                      <div className="px-3 py-2.5 border-b border-seam">
                        <p className="label">Signed in</p>
                        <p className="data text-xs text-ink-muted truncate mt-1">{userEmail}</p>
                      </div>
                      <button
                        onClick={() => {
                          setConfirmLogout(true)
                          setUserMenuOpen(false)
                        }}
                        className="w-full px-3 py-3 text-left text-[13px] text-ink-muted hover:text-ink hover:bg-plate transition-colors flex items-center gap-2 min-h-[44px]"
                      >
                        <LogOut className="w-4 h-4" aria-hidden="true" />
                        Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 px-4 sm:px-6 lg:px-10 py-8 lg:py-12">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>

      <Dialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Log out</DialogTitle>
          <DialogDescription className="mt-2">
            You will be signed out of <span className="data text-ink">{userEmail}</span>. Projects and data stay
            on the server.
          </DialogDescription>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" className="flex-1 h-10" onClick={() => setConfirmLogout(false)} disabled={loggingOut}>
              Cancel
            </Button>
            <Button variant="destructive" className="flex-1 h-10" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? 'Signing out' : 'Log out'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
