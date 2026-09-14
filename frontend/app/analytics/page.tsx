'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Database, HardDrive, KeyRound, Clock, Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { AlertBanner } from '@/components/alert-banner'
import { apiUrl } from '@/lib/api'
import type { Stats, LogEntry } from '@/lib/types'
import { formatBytes, relativeTime, levelDotClass } from '@/lib/utils'

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
    <Card>
      <CardContent className="p-4 lg:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const [statsRes, logsRes] = await Promise.all([
        fetch(apiUrl('/api/stats'), { credentials: 'include' }),
        fetch(apiUrl('/api/logs'), { credentials: 'include' }),
      ])
      if (!statsRes.ok) throw new Error('stats')
      setStats((await statsRes.json()) as Stats)
      if (logsRes.ok) setLogs((await logsRes.json()) as LogEntry[])
      setLoadErr(null)
    } catch {
      setLoadErr('Could not load analytics. Is the backend running on :8000?')
    }
  }, [])

  useEffect(() => {
    load()

    // Visibility-aware polling
    const startPolling = () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(load, 5000)
    }

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling()
      } else {
        stopPolling()
      }
    }

    // Start polling initially
    startPolling()

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [load])

  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6 lg:space-y-8">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live project metrics and activity — sourced directly from the backend
          </p>
        </div>

        {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

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
            subtext={stats ? `Last backup ${relativeTime(stats.last_backup)}` : '—'}
            icon={Clock}
          />
        </div>

        {/* ── Project + storage overview ── */}
        <Card>
          <CardContent className="p-4 lg:p-5">
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
          </CardContent>
        </Card>

        {/* ── Live activity feed (from /api/logs) ── */}
        <Card>
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
        </Card>

        <p className="text-xs text-muted-foreground">
          Note: request-volume, per-endpoint latency, and error-rate breakdowns are not
          tracked by the backend yet. The metrics above reflect the actual state of your
          project.
        </p>
      </div>
    </PyroCoreLayout>
  )
}
