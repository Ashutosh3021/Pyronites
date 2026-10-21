'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useEffect, useState, useRef, useCallback } from 'react'
import { Database, HardDrive, KeyRound, Clock, Activity } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { AlertBanner } from '@/components/alert-banner'
import { EmptyState } from '@/components/empty-state'
import { apiUrl, API_BASE, getStoredProjectId, PROJECT_CHANGE_EVENT } from '@/lib/api'
import type { Stats, LogEntry } from '@/lib/types'
import { formatBytes, relativeTime } from '@/lib/utils'

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
    <div className="bg-plate p-4 lg:p-5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
        <p className="label">{label}</p>
      </div>
      <p className="data text-[26px] leading-none text-ink">{value}</p>
      {subtext && <p className="data text-[11px] text-ink-faint">{subtext}</p>}
    </div>
  )
}

const RANGE_SECONDS: Record<'1h' | '6h' | '24h' | '7d', number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
}

// ─── Metrics types ────────────────────────────────────────────────────────────

type MetricsPoint = {
  t: number
  requests: number
  avg_ms: number | null
  errors: number
  server_errors: number
}

type MetricsResponse = {
  range_seconds: number
  bucket_seconds: number
  points: MetricsPoint[]
  totals: {
    requests: number
    errors: number
    server_errors: number
    error_rate: number
    avg_ms: number | null
    p50_ms: number | null
    p95_ms: number | null
    p99_ms: number | null
  }
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'error'
}) {
  return (
    <div className="bg-plate-raised border border-seam p-3">
      <p className="label">{label}</p>
      <p
        className={[
          'data mt-2 text-[17px] leading-none',
          tone === 'error' ? 'text-error' : 'text-ink',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}

function formatTick(ms: number, spanSeconds: number): string {
  const d = new Date(ms)
  if (spanSeconds <= 3600) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Shared axis/tooltip styling. Hard edges, matching the rest of the app. */
const AXIS = { stroke: 'var(--border)', fontSize: 11 } as const

function TrafficChart({
  data,
  loading,
  spanSeconds = 24 * 3600,
}: {
  data: MetricsPoint[]
  loading: boolean
  spanSeconds?: number
}) {
  if (!loading && data.every((p) => p.requests === 0)) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No traffic in this window"
        description="Once your app calls this backend, requests and latency appear here automatically."
      />
    )
  }

  const rows = data.map((p) => ({ ...p, time: formatTick(p.t, spanSeconds) }))

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Request volume</p>
        <div className="h-48 w-full" aria-label="Request volume over time">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pyro-orange)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--pyro-orange)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
              <RTooltip
                cursor={{ stroke: 'var(--pyro-orange)', strokeWidth: 1 }}
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 0,
                  fontSize: 12,
                  color: 'var(--foreground)',
                }}
                labelStyle={{ color: 'var(--muted-foreground)' }}
              />
              <Area
                type="monotone"
                dataKey="requests"
                name="Requests"
                stroke="var(--pyro-orange)"
                strokeWidth={2}
                fill="url(#reqFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-1 pt-4">
        <p className="text-xs font-medium text-foreground">Latency &amp; errors</p>
        <div className="h-48 w-full" aria-label="Latency and errors over time">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="time" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis yAxisId="ms" tick={AXIS} tickLine={false} axisLine={false} width={48} />
              <YAxis yAxisId="err" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <RTooltip
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 0,
                  fontSize: 12,
                  color: 'var(--foreground)',
                }}
                labelStyle={{ color: 'var(--muted-foreground)' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                yAxisId="ms"
                type="monotone"
                dataKey="avg_ms"
                name="Avg latency (ms)"
                stroke="var(--chart-2)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="err"
                type="stepAfter"
                dataKey="errors"
                name="Errors"
                stroke="var(--chart-5)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [range, setRange] = useState<'1h' | '6h' | '24h' | '7d'>('24h')
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

  const loadMetrics = useCallback(async () => {
    const pid = getStoredProjectId()
    if (!pid) {
      setMetricsData(null)
      setMetricsLoading(false)
      return
    }
    setMetricsLoading(true)
    try {
      // Built by hand: apiUrl() only rewrites the unscoped data routes, and
      // this one is already project-scoped.
      const res = await fetch(
        `${API_BASE}/api/projects/${encodeURIComponent(pid)}/metrics?range=${range}`,
        { credentials: 'include' }
      )
      if (!res.ok) throw new Error(String(res.status))
      setMetricsData((await res.json()) as MetricsResponse)
    } catch {
      // Leave the previous series on screen rather than blanking the charts.
      setMetricsData(null)
    } finally {
      setMetricsLoading(false)
    }
  }, [range])

  useEffect(() => {
    loadMetrics()
    const onProjectChange = () => loadMetrics()
    window.addEventListener(PROJECT_CHANGE_EVENT, onProjectChange)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, onProjectChange)
  }, [loadMetrics])

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
      <PageHeader
        meta="Measured traffic"
        title="Analytics"
        description="Counts, latency and errors recorded at the API layer of this project. The window can be changed; the numbers come from the server, not from the browser."
      />

      {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

      {/* ── Real stat cards (from /api/stats) ── */}
      <dl className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-px bg-seam border border-seam">
        <StatCard
          label="Tables"
          value={stats ? String(stats.table_count) : '—'}
          subtext="user tables in this project"
          icon={Database}
        />
        <StatCard
          label="Stored files"
          value={stats ? String(stats.file_count) : '—'}
          subtext="uploaded via storage API"
          icon={HardDrive}
        />
        <StatCard
          label="API keys"
          value={stats ? String(stats.key_count) : '—'}
          subtext="active keys (unrevoked)"
          icon={KeyRound}
        />
        <StatCard
          label="Database size"
          value={stats ? formatBytes(stats.db_size_bytes) : '—'}
          subtext={stats ? `Last backup ${relativeTime(stats.last_backup)}` : '—'}
          icon={Clock}
        />
      </dl>

      {/* ── Traffic over time (from /api/projects/{id}/metrics) ── */}
      <Card className="mt-8">
        <div className="px-4 lg:px-5 py-4 border-b border-seam flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" aria-hidden="true" />
            <h2 className="text-[15px] font-semibold text-ink">Traffic</h2>
          </div>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Time window">
            {(['1h', '6h', '24h', '7d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={[
                  'data px-2.5 py-1 text-[12px] border transition-colors min-h-[32px]',
                  range === r
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-seam text-ink-muted hover:border-seam-strong hover:text-ink',
                ].join(' ')}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <CardContent className="p-4 lg:p-5 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <MetricTile label="Requests" value={metricsData?.totals.requests ?? '—'} />
            <MetricTile
              label="Error rate"
              value={metricsData ? `${metricsData.totals.error_rate}%` : '—'}
              tone={metricsData && metricsData.totals.error_rate > 5 ? 'error' : undefined}
            />
            <MetricTile
              label="p95 latency"
              value={metricsData?.totals.p95_ms != null ? `${metricsData.totals.p95_ms} ms` : '—'}
            />
            <MetricTile
              label="Server errors"
              value={metricsData?.totals.server_errors ?? '—'}
              tone={metricsData && metricsData.totals.server_errors > 0 ? 'error' : undefined}
            />
          </div>

          <TrafficChart
            data={metricsData?.points ?? []}
            loading={metricsLoading}
            spanSeconds={metricsData?.range_seconds ?? RANGE_SECONDS[range]}
          />

          <p className="text-[12px] text-ink-faint">
            {metricsData && metricsData.totals.requests === 0
              ? 'No project traffic recorded in this window yet. The charts fill in as requests arrive.'
              : `Measured at the API layer. Buckets are ${Math.round((metricsData?.bucket_seconds ?? 0) / 60)} minute(s) wide.`}
          </p>
        </CardContent>
      </Card>

      {/* ── Project + storage overview ── */}
      <Card className="mt-6">
        <CardContent className="p-4 lg:p-5">
          <h2 className="text-[15px] font-semibold text-ink mb-4">Project</h2>
          {stats?.project ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between gap-4 border-b border-seam pb-2">
                <dt className="text-[13px] text-ink-muted">Project</dt>
                <dd className="text-[13px] text-ink font-medium text-right">
                  {stats.project.project_name}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-seam pb-2">
                <dt className="text-[13px] text-ink-muted">Project id</dt>
                <dd className="data text-[12px] text-ink">{stats.project.project_id}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-seam pb-2">
                <dt className="text-[13px] text-ink-muted">Backup interval</dt>
                <dd className="text-[13px] text-ink capitalize">{stats.project.backup_interval ?? '1hour'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-seam pb-2">
                <dt className="text-[13px] text-ink-muted">Created</dt>
                <dd className="data text-[12px] text-ink">
                  {stats.project.created_at ? new Date(stats.project.created_at).toLocaleString() : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-ink-muted">No project data available.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Live activity feed (from /api/logs) ── */}
      <Card className="mt-6 overflow-hidden">
        <div className="px-4 lg:px-5 py-4 border-b border-seam flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold text-ink">Recent activity</h2>
          <span className="data text-[11px] text-ink-faint ml-auto">refreshes every 5s</span>
        </div>

        {logs.length === 0 ? (
          <EmptyState
            compact
            icon={Activity}
            title={loadErr ? 'No activity available' : 'No recent activity'}
            description="Events appear here as the container handles requests."
          />
        ) : (
          <ul className="divide-y divide-seam">
            {logs.slice(0, 25).map((log) => (
              <li
                key={log.id}
                className="row-seam flex items-center gap-3 px-4 lg:px-5 py-3 min-h-[52px] hover:bg-plate-raised/60 transition-colors"
                data-level={log.level}
              >
                <p className="text-[13px] text-ink truncate flex-1 min-w-0">{log.action}</p>
                <span className="data text-[11px] text-ink-faint flex-shrink-0 hidden sm:inline">
                  {log.timestamp?.replace('T', ' ').slice(0, 19)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-6 text-[12px] text-ink-faint max-w-[70ch]">
        Every figure here is recorded by the backend as it serves requests: one row per request with
        its duration and status code, rolled up into the window you picked. Nothing is sampled in the
        browser and nothing is estimated.
      </p>
    </PyroCoreLayout>
  )
}
