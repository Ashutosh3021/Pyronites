'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { Database, Brackets, Archive, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Stats {
  table_count: number
  file_count: number
  key_count: number
  db_size_bytes: number
  last_backup: string | null
  project: { project_id: string; project_name: string; backup_interval: string } | null
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  action: string
  statusCode?: number
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Unknown'
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

function levelColor(level: string): string {
  switch (level) {
    case 'success':
      return 'var(--success)'
    case 'warning':
      return 'var(--warning)'
    case 'error':
      return 'var(--error)'
    default:
      return 'var(--pyro-orange)'
  }
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<LogEntry[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/logs`, { credentials: 'include' }),
      ])
      if (!sRes.ok) throw new Error('stats')
      const stats = (await sRes.json()) as Stats
      setStats(stats)
      if (lRes.ok) {
        const logs = (await lRes.json()) as LogEntry[]
        setActivity(logs.slice(0, 5))
      }
    } catch {
      setLoadErr('Could not load overview. Is the backend running on :8000?')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const tableCount = stats?.table_count ?? 0
  const fileCount = stats?.file_count ?? 0
  const keyCount = stats?.key_count ?? 0
  const dbSize = stats?.db_size_bytes ?? 0

  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6 lg:space-y-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground mb-2">
            Project Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            {stats?.project?.project_name
              ? `Status of ${stats.project.project_name}`
              : 'Status and quick access to your backend infrastructure'}
          </p>
        </div>

        {loadErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
            {loadErr}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          <div className="bg-card border border-border p-5 lg:p-6 hover:border-accent/30 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">Database</h3>
              <Database className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--pyro-orange)' }} />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">File Size</p>
                <p className="text-lg font-semibold text-foreground">{formatBytes(dbSize)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Tables</p>
                  <p className="text-foreground font-medium">{tableCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mode</p>
                  <p className="text-foreground font-medium">WAL</p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Last backup: {relativeTime(stats?.last_backup ?? null)}</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-5 lg:p-6 hover:border-accent/30 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">API</h3>
              <Brackets className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--pyro-orange)' }} />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">API Keys</p>
                <p className="text-lg font-semibold text-foreground">{keyCount}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Project</p>
                  <p className="text-foreground font-medium truncate">{stats?.project?.project_id ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Backup</p>
                  <p className="text-foreground font-medium">{stats?.project?.backup_interval ?? '—'}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Uptime: —</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-5 lg:p-6 hover:border-accent/30 transition-colors sm:col-span-2 lg:col-span-1">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">Storage</h3>
              <Archive className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--pyro-orange)' }} />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Files</p>
                <p className="text-lg font-semibold text-foreground">{fileCount}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Total Used</p>
                  <p className="text-foreground font-medium">{formatBytes(dbSize)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Location</p>
                  <p className="text-foreground font-medium capitalize">{stats?.project?.storage_location ?? 'Local'}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Limit: 100 GB</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-base lg:text-lg font-semibold text-foreground mb-4">Recent Activity</h2>
          <div className="bg-card border border-border divide-y divide-border">
            {activity.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">No recent activity.</div>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="flex items-center hover:bg-muted/30 transition-colors overflow-hidden min-h-[52px]">
                  <div
                    className="w-1 self-stretch flex-shrink-0"
                    style={{ backgroundColor: levelColor(item.level) }}
                  />
                  <div className="flex items-center gap-3 lg:gap-4 px-4 lg:px-5 py-3 flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground font-mono w-24 lg:w-32 flex-shrink-0">
                      {item.timestamp?.replace('T', ' ').slice(0, 19)}
                    </p>
                    <p className="text-sm text-foreground truncate">{item.action}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="text-base lg:text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'New Table', href: '/database' },
              { label: 'Run Backup', href: '/settings' },
              { label: 'Create API Key', href: '/api-keys' },
              { label: 'View Logs', href: '/logs' },
            ].map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="btn-primary flex items-center justify-center gap-2 text-center min-h-[44px]"
              >
                <span>{action.label}</span>
                <ArrowRight className="w-3 h-3 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
