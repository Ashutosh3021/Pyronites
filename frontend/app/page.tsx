'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { Core } from '@/components/core'
import { Database, Brackets, Archive, ArrowRight, Table2, Key, ScrollText } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { AlertBanner } from '@/components/alert-banner'
import { EmptyState } from '@/components/empty-state'
import { apiUrl } from '@/lib/api'
import type { Stats, LogEntry } from '@/lib/types'
import { formatBytes, relativeTime, levelColor } from '@/lib/utils'

function PlateSkeleton() {
  return (
    <div className="plate p-5 space-y-4">
      <div className="h-2.5 w-20 bg-muted animate-pulse" />
      <div className="h-6 w-24 bg-muted animate-pulse" />
      <div className="h-2.5 w-full bg-muted/60 animate-pulse" />
    </div>
  )
}

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadErr(null)
    setLoading(true)
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(apiUrl('/api/stats'), { credentials: 'include' }),
        fetch(apiUrl('/api/logs'), { credentials: 'include' }),
      ])
      if (!sRes.ok) {
        // A 404 here almost never means "server down". apiUrl() rewrites this
        // to /api/projects/{id}/stats, so 404 means the active project id is no
        // longer on the server — a different account, or a redeploy that
        // restored the database with fresh ids. Saying "is the backend
        // running?" sends the user debugging the wrong thing.
        setLoadErr(
          sRes.status === 404
            ? 'This project is no longer available on the server. Reload the page to select the current one.'
            : `Could not load overview — the server returned HTTP ${sRes.status}.`
        )
        return
      }
      const stats = (await sRes.json()) as Stats
      setStats(stats)
      if (lRes.ok) {
        const logs = (await lRes.json()) as LogEntry[]
        setActivity(logs.slice(0, 8))
      }
    } catch {
      setLoadErr('Could not reach the backend. Check the API URL and your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const tableCount = stats?.table_count ?? 0
  const fileCount = stats?.file_count ?? 0
  const keyCount = stats?.key_count ?? 0
  const dbSize = stats?.db_size_bytes ?? 0
  const projectName = stats?.project?.project_name
  const projectId = stats?.project?.project_id

  return (
    <PyroCoreLayout>
      {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

      {/* ── Hero: the core, the name, the numbers ────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-12 items-start">
        <div className="lg:col-span-7 flex flex-col gap-10">
          <div>
            <p className="label">Overview</p>
            <h1 className="display mt-4 text-[clamp(2.5rem,1.1rem+4.2vw,4.5rem)] break-words">
              {projectName ?? 'Your backend'}
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-muted max-w-[52ch]">
              Every figure on this page is read from the running container. Nothing here is a
              placeholder, and nothing is cached from a previous session.
            </p>
          </div>

          {loading && !stats ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-seam border border-seam">
              <PlateSkeleton />
              <PlateSkeleton />
              <PlateSkeleton />
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-seam border border-seam">
              <div className="bg-plate p-5">
                <dt className="label flex items-center gap-2">
                  <Database className="w-3.5 h-3.5" aria-hidden="true" />
                  Database
                </dt>
                <dd className="data mt-3 text-[26px] leading-none text-ink">{formatBytes(dbSize)}</dd>
                <dd className="data mt-2 text-[11px] text-ink-faint">{tableCount} tables</dd>
              </div>
              <div className="bg-plate p-5">
                <dt className="label flex items-center gap-2">
                  <Brackets className="w-3.5 h-3.5" aria-hidden="true" />
                  API keys
                </dt>
                <dd className="data mt-3 text-[26px] leading-none text-ink">{keyCount}</dd>
                <dd className="data mt-2 text-[11px] text-ink-faint">scoped to this project</dd>
              </div>
              <div className="bg-plate p-5">
                <dt className="label flex items-center gap-2">
                  <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                  Storage
                </dt>
                <dd className="data mt-3 text-[26px] leading-none text-ink">{fileCount}</dd>
                <dd className="data mt-2 text-[11px] text-ink-faint capitalize">
                  {stats?.project?.storage_location ?? 'local'}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {/* The Core: the backend's live request rate, drawn as heat. */}
        <div className="lg:col-span-5">
          <div className="flex justify-center lg:justify-end">
            <Core size={300} className="lg:size-[320px]" />
          </div>
          <div className="mt-8 border-t border-seam pt-5 flex items-end justify-between gap-6">
            <div>
              <p className="label">Core state</p>
              <p className="display mt-2 text-[clamp(1.9rem,1.3rem+2vw,2.9rem)] text-accent" data-core-state>
                IDLE
              </p>
            </div>
            <div className="text-right">
              <p className="label">Requests per minute</p>
              <p className="data mt-2 text-[26px] leading-none text-ink">
                <span data-core-rate>0</span>
              </p>
              <p className="data mt-1.5 text-[11px] text-ink-faint">5 min average</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Activity and runtime ──────────────────────────────────────────── */}
      <section className="mt-16 lg:mt-24 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
        <div className="lg:col-span-7">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="text-[15px] font-semibold text-ink">Recent activity</h2>
            <p className="data text-[11px] text-ink-faint">
              {activity.length} {activity.length === 1 ? 'event' : 'events'}
            </p>
          </div>

          <div className="plate overflow-hidden">
            {loading && activity.length === 0 ? (
              <div className="p-5 space-y-3">
                <div className="h-3 w-full bg-muted animate-pulse" />
                <div className="h-3 w-5/6 bg-muted animate-pulse" />
                <div className="h-3 w-2/3 bg-muted animate-pulse" />
              </div>
            ) : activity.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title="No activity yet"
                description="Requests and writes land here as soon as the backend starts serving."
              />
            ) : (
              <ul className="divide-y divide-seam">
                {activity.map((item) => (
                  <li
                    key={item.id}
                    className="row-seam flex items-center gap-4 px-4 py-3 transition-colors hover:bg-plate-raised/70"
                    data-level={item.level}
                  >
                    <span className="data text-[11px] text-ink-faint w-[136px] flex-shrink-0 truncate">
                      {item.timestamp?.replace('T', ' ').slice(0, 19)}
                    </span>
                    <span className="text-[13px] text-ink truncate flex-1 min-w-0">{item.action}</span>
                    <span
                      className="data text-[11px] flex-shrink-0"
                      style={{ color: levelColor(item.level) }}
                    >
                      {item.level}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-8">
          <div>
            <h2 className="text-[15px] font-semibold text-ink mb-4">Project runtime</h2>
            <dl className="plate divide-y divide-seam">
              {[
                { term: 'Project id', value: projectId ?? '—' },
                { term: 'Backup interval', value: stats?.project?.backup_interval ?? '—' },
                { term: 'Storage', value: stats?.project?.storage_location ?? 'local' },
                { term: 'Last backup', value: relativeTime(stats?.last_backup ?? null) },
              ].map((row) => (
                <div key={row.term} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <dt className="text-[12.5px] text-ink-muted">{row.term}</dt>
                  <dd className="data text-[12px] text-ink truncate">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-[15px] font-semibold text-ink mb-4">Quick actions</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'New table', href: '/database', icon: Table2 },
                { label: 'Run SQL', href: '/sql-editor', icon: Brackets },
                { label: 'Create API key', href: '/api-keys', icon: Key },
                { label: 'View logs', href: '/logs', icon: ScrollText },
              ].map((action) => (
                <Link key={action.label} href={action.href} className="block group">
                  <Button variant="outline" className="w-full justify-between h-11">
                    <span className="flex items-center gap-2">
                      <action.icon className="w-4 h-4 text-ink-muted" aria-hidden="true" />
                      {action.label}
                    </span>
                    <ArrowRight
                      className="w-3.5 h-3.5 text-ink-faint transition-transform duration-300 group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PyroCoreLayout>
  )
}
