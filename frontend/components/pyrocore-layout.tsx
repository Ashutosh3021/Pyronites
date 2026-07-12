'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

export function PyroCoreLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Desktop: sidebar always open; mobile/tablet: closed by default
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  // Close sidebar on route change (mobile nav item tap)
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  // Close sidebar on desktop resize (re-entering lg range)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Current page label for mobile top nav
  const currentPage = navItems.find((item) => item.href === pathname)?.label ?? 'PyroCore'

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      {/*
        Desktop (lg+): static in-flow 280px column, always visible.
        Below lg: fixed overlay, slides in from left, 280px, z-50.
      */}
      <aside
        className={[
          // Shared
          'bg-card border-r border-border flex-shrink-0 flex flex-col',
          // Desktop: static, always visible
          'lg:relative lg:translate-x-0 lg:w-70 lg:z-auto',
          // Mobile/tablet: fixed overlay, transitions
          'fixed top-0 left-0 bottom-0 w-72 z-50',
          'transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
        aria-label="Main navigation"
      >
        <div className="h-full flex flex-col overflow-hidden">
          {/* Logo / Header */}
          <div className="px-6 py-5 border-b border-border flex-shrink-0 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">PyroCore</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Backend Control</p>
            </div>
            {/* X button — only visible on mobile/tablet overlay */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 -mr-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>

          {/* Nav Items */}
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
                    // Left border — 4px active orange, transparent inactive (keeps spacing consistent)
                    'border-l-4 pl-3 pr-4',
                    // Min touch target height: 44px — py-3 on text-sm gives ~44px
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

          {/* Bottom Info */}
          <div className="px-4 py-4 border-t border-border flex-shrink-0 space-y-1 text-xs text-muted-foreground">
            <p>v0.1.0</p>
            <p>Project: my-project</p>
          </div>
        </div>
      </aside>

      {/* ── SCRIM — mobile/tablet only, behind sidebar ───────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: 'rgba(17,17,17,0.7)' }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top Nav */}
        <header className="h-14 lg:h-16 bg-card border-b border-border px-4 lg:px-6 flex items-center justify-between flex-shrink-0 gap-3">

          {/* Left: hamburger (mobile/tablet) */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-1 text-foreground hover:bg-muted rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" strokeWidth={2} />
          </button>

          {/* Center/left: page name on mobile, spacer on desktop */}
          <span className="lg:hidden text-sm font-medium text-foreground truncate flex-1">
            {currentPage}
          </span>
          <div className="hidden lg:block flex-1" />

          {/* Right: Core Status */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Orange dot — always visible */}
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: 'var(--pyro-orange)' }}
            />
            {/* "Core Status" text — hidden on mobile to save space */}
            <span className="hidden sm:block text-xs text-muted-foreground">
              Core Status
            </span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
