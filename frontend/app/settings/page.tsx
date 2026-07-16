'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Copy, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const settingsTabs = [
  { id: 'general', label: 'General' },
  { id: 'database', label: 'Database' },
  { id: 'api', label: 'API' },
  { id: 'danger', label: 'Danger Zone' },
] as const

type Tab = typeof settingsTabs[number]['id']

interface Stats {
  table_count: number
  file_count: number
  key_count: number
  db_size_bytes: number
  last_backup: string | null
  project: { project_id: string; project_name: string; backup_interval: string; created_at: string } | null
}

interface Backup {
  name: string
  created_at: string
  size_bytes: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')
  const [projectName, setProjectName] = useState('')
  const [backupInterval, setBackupInterval] = useState('1hour')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')

  const [stats, setStats] = useState<Stats | null>(null)
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text) }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const [sRes, bRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/backups`, { credentials: 'include' }),
      ])
      if (!sRes.ok) throw new Error('stats')
      const s = (await sRes.json()) as Stats
      setStats(s)
      setProjectName(s.project?.project_name ?? '')
      if (s.project?.backup_interval) setBackupInterval(s.project.backup_interval)
      if (bRes.ok) setBackups((await bRes.json()) as Backup[])
    } catch {
      setLoadErr('Could not load settings. Is the backend running on :8000?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleBackup = async () => {
    setBackingUp(true)
    setBackupMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/backup`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Backup failed.')
      }
      setBackupMsg('Backup completed.')
      load()
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : 'Backup failed.')
    } finally {
      setBackingUp(false)
    }
  }

  const projectId = stats?.project?.project_id ?? 'proj_unknown'
  const createdAt = stats?.project?.created_at ?? null
  const connectionString = `pyrocore.db  ·  project: ${projectId}`

  return (
    <PyroCoreLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your project configuration</p>
        </div>

        {loadErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>
        )}

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          <div className="flex lg:hidden gap-1 border-b border-border overflow-x-auto pb-0 -mb-px">
            {settingsTabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors min-h-[44px] flex-shrink-0 ${
                  tab === item.id
                    ? 'border-accent text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="hidden lg:flex w-48 flex-col gap-1 flex-shrink-0">
            {settingsTabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-4 py-2 text-sm font-medium text-left transition-colors min-h-[44px] ${
                  tab === item.id
                    ? 'bg-muted text-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            {tab === 'general' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Project Name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Project ID</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {projectId}
                    </code>
                    <button
                      onClick={() => copyToClipboard(projectId)}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Created</label>
                  <p className="px-3 py-2 text-sm text-muted-foreground">{fmtDate(createdAt)}</p>
                </div>
                <button className="btn-primary min-h-[44px]" disabled>Save Changes</button>
              </div>
            )}

            {tab === 'database' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Connection String</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {connectionString}
                    </code>
                    <button
                      onClick={() => copyToClipboard(connectionString)}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 border border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">WAL Mode</h3>
                    <p className="text-xs text-muted-foreground mt-1">Write-Ahead Logging improves concurrency and durability</p>
                  </div>
                  <div className="w-12 h-6 rounded-full relative flex-shrink-0 bg-success">
                    <div className="w-5 h-5 rounded-full bg-foreground absolute top-0.5 translate-x-6" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Backup Interval</label>
                  <select
                    value={backupInterval}
                    onChange={(e) => setBackupInterval(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]"
                  >
                    <option value="15min">Every 15 minutes</option>
                    <option value="1hour">Every 1 hour</option>
                    <option value="6hours">Every 6 hours</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button onClick={handleBackup} disabled={backingUp} className="px-4 py-2 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px] flex items-center gap-2 disabled:opacity-70">
                    {backingUp ? <><RefreshCw className="w-4 h-4 animate-spin" />Backing up…</> : 'Back Up Now'}
                  </button>
                  <button className="btn-primary min-h-[44px]" disabled>Save Changes</button>
                </div>
                {backupMsg && (
                  <p className="text-sm flex items-center gap-2" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 className="w-4 h-4" />{backupMsg}
                  </p>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Recent Backups</h3>
                  {backups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No backups yet. Run one with “Back Up Now”.</p>
                  ) : (
                    <div className="space-y-2">
                      {backups.map((b) => (
                        <div key={b.name} className="flex items-center justify-between px-3 py-2 border border-border text-sm min-h-[44px]">
                          <span className="font-mono text-muted-foreground truncate">{b.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{fmtDate(b.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'api' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Base URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {API_BASE}
                    </code>
                    <button
                      onClick={() => copyToClipboard(API_BASE)}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">API Keys</label>
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {stats?.key_count ?? 0} active key(s). Manage them on the{' '}
                    <a href="/api-keys" className="underline hover:text-foreground" style={{ color: 'var(--pyro-orange)' }}>API Keys</a> page.
                  </p>
                </div>
                <button className="btn-primary min-h-[44px]" disabled>Save Changes</button>
              </div>
            )}

            {tab === 'danger' && (
              <div className="space-y-6 border-t-2 border-error pt-6">
                <div className="p-4 bg-error/10 border border-error">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-error flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-error mb-1">Danger Zone</h3>
                      <p className="text-xs text-error/80">These actions are irreversible. Proceed with caution.</p>
                    </div>
                  </div>
                </div>

                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="px-4 py-2 bg-error/20 text-error text-sm font-medium hover:bg-error/30 transition-colors min-h-[44px]"
                  >
                    Delete Project
                  </button>
                ) : (
                  <div className="space-y-4 p-4 border border-error/30">
                    <p className="text-sm text-foreground">
                      To confirm, type the project name:{' '}
                      <span className="font-mono text-accent">{projectName}</span>
                    </p>
                    <input
                      type="text"
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      placeholder="Type project name..."
                      className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-error min-h-[44px]"
                    />
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => { setDeleteConfirm(false); setDeleteInput('') }}
                        className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={deleteInput !== projectName}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors min-h-[44px] ${
                          deleteInput === projectName
                            ? 'bg-error text-error-foreground hover:bg-error/90'
                            : 'bg-muted text-muted-foreground cursor-not-allowed'
                        }`}
                      >
                        Delete Project
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
