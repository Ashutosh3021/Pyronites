'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useEffect, useState } from 'react'
import { Database, HardDrive, KeyRound, Clock, Activity } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Stats {
  table_count: number
  file_count: number
  key_count: number
  db_size_bytes: number
  last_backup: string | null
  project: {
    project_id: string
    project_name: string
    backup_interval?: string
    created_at?: string
  } | null
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success'
  action: string
  statusCode?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}

const levelDotClass = (level: string) => {
  switch (level) {
    case 'error': return 'bg-error'
    case 'warning': return 'bg-warning'
    case 'success': return 'bg-success'
    default: return 'bg-info'
  }
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
}: {
  label: string
  value: string
  subtext?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="bg-card border border-border p-4 lg:p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [statsRes, logsRes] = await Promise.all([
          fetch(`${API_BASE}/api/stats`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/logs`, { credentials: 'include' }),
        ])
        if (!statsRes.ok) throw new Error('stats')
        if (!alive) return
        setStats((await statsRes.json()) as Stats)
        if (logsRes.ok) setLogs((await logsRes.json()) as LogEntry[])
        setLoadErr(null)
      } catch {
        if (alive) setLoadErr('Could not load analytics. Is the backend running on :8000?')
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6 lg:space-y-8">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live project metrics and activity — sourced directly from the backend
          </p>
        </div>

        {loadErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>
        )}

        {/* ── Real stat cards (from /api/stats) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <StatCard
            label="Tables"
            value={stats ? String(stats.table_count) : '—'}
            subtext="user tables in this project"
            icon={Database}
          />
          <StatCard
            label="Stored Files"
            value={stats ? String(stats.file_count) : '—'}
            subtext="uploaded via storage API"
            icon={HardDrive}
          />
          <StatCard
            label="API Keys"
            value={stats ? String(stats.key_count) : '—'}
            subtext="active keys (unrevoked)"
            icon={KeyRound}
          />
          <StatCard
            label="Database Size"
            value={stats ? formatBytes(stats.db_size_bytes) : '—'}
            subtext={stats ? `Last backup ${formatRelative(stats.last_backup)}` : '—'}
            icon={Clock}
          />
        </div>

        {/* ── Project + storage overview ── */}
        <div className="bg-card border border-border p-4 lg:p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Project Overview</h2>
          {stats?.project ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Project</dt>
                <dd className="text-foreground font-medium text-right">
                  {stats.project.project_name}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Project ID</dt>
                <dd className="text-foreground font-mono text-xs">{stats.project.project_id}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Backup Interval</dt>
                <dd className="text-foreground font-medium capitalize">
                  {stats.project.backup_interval ?? '1hour'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground font-mono text-xs">
                  {stats.project.created_at
                    ? new Date(stats.project.created_at).toLocaleString()
                    : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No project data available.</p>
          )}
        </div>

        {/* ── Live activity feed (from /api/logs) ── */}
        <div className="bg-card border border-border overflow-hidden">
          <div className="px-4 lg:px-5 py-4 border-b border-border flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            <span className="text-xs text-muted-foreground">(auto-refreshes every 5s)</span>
          </div>

          {logs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              {loadErr ? 'No activity available.' : 'No recent activity'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {logs.slice(0, 25).map((log) => (
                <div key={log.id} className="flex items-center gap-3 px-4 lg:px-5 py-3 min-h-[52px]">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${levelDotClass(log.level)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{log.action}</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground flex-shrink-0 hidden sm:inline">
                    {log.timestamp?.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Note: request-volume, per-endpoint latency, and error-rate breakdowns are not
          tracked by the backend yet. The metrics above reflect the actual state of your
          project.
        </p>
      </div>
    </PyroCoreLayout>
  )
}
