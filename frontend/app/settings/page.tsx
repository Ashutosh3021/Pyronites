'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react'
import {
  getStoredProjectId,
  getStoredProjectName,
  setStoredProject,
  clearStoredProject,
  apiUrl,
  API_BASE,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'

const settingsTabs = [
  { id: 'general', label: 'General' },
  { id: 'database', label: 'Database' },
  { id: 'api', label: 'API' },
  { id: 'danger', label: 'Danger Zone' },
] as const

type Tab = typeof settingsTabs[number]['id']

interface ProjectDetail {
  id: string
  project_id: string
  slug?: string
  name: string
  status?: string
  backup_interval?: string
  storage_location?: string
  created_at?: string
  updated_at?: string
}

interface Stats {
  table_count: number
  file_count: number
  key_count: number
  db_size_bytes: number
  last_backup: string | null
  project: {
    id?: string
    project_id: string
    project_name: string
    backup_interval: string
    created_at?: string
  } | null
}

interface Backup {
  name: string
  created_at: string
  size_bytes: number
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SettingsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('general')
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [projectName, setProjectName] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [backupInterval, setBackupInterval] = useState('1hour')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

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
    setSaveMsg(null)
    const storedId = getStoredProjectId()

    try {
      // 1) Project registry for the selected project (source of truth for name/id)
      let detail: ProjectDetail | null = null
      if (storedId) {
        const pRes = await fetch(
          `${API_BASE}/api/projects/${encodeURIComponent(storedId)}`,
          { credentials: 'include' },
        )
        if (pRes.ok) {
          detail = (await pRes.json()) as ProjectDetail
          setProject(detail)
          setProjectName(detail.name || '')
          setConfirmName(detail.name || '')
          if (detail.backup_interval) setBackupInterval(detail.backup_interval)
          // Keep localStorage name in sync
          setStoredProject({ id: detail.id, name: detail.name })
        }
      }

      // 2) Scoped stats (tables/keys/files for THIS project)
      const sRes = await fetch(apiUrl('/api/stats'), { credentials: 'include' })
      if (sRes.ok) {
        const s = (await sRes.json()) as Stats
        setStats(s)
        // If we had no stored project yet, adopt stats project
        if (!detail && s.project) {
          const name = s.project.project_name ?? ''
          setProjectName(name)
          setConfirmName(name)
          if (s.project.backup_interval) setBackupInterval(s.project.backup_interval)
          if (s.project.id) {
            setStoredProject({ id: s.project.id, name })
            setProject({
              id: s.project.id,
              project_id: s.project.project_id,
              name,
              backup_interval: s.project.backup_interval,
              created_at: s.project.created_at,
            })
          }
        }
      } else if (!detail) {
        throw new Error('stats')
      }

      const bRes = await fetch(`${API_BASE}/api/backups`, { credentials: 'include' })
      if (bRes.ok) setBackups((await bRes.json()) as Backup[])
    } catch {
      setLoadErr(`Could not load settings for the selected project.`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const onProjectChange = () => {
      load()
    }
    window.addEventListener(PROJECT_CHANGE_EVENT, onProjectChange)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, onProjectChange)
  }, [load])

  const handleSave = async () => {
    const id = project?.id || getStoredProjectId()
    if (!id || !projectName.trim()) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: projectName.trim(),
          backup_interval: backupInterval,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message || `Save failed (${res.status})`)
      }
      const updated = (await res.json()) as ProjectDetail
      setProject(updated)
      setConfirmName(updated.name)
      setStoredProject({ id: updated.id, name: updated.name })
      setSaveMsg('Saved.')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

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

  const handleDelete = async () => {
    if (deleteInput !== confirmName || !confirmName) return
    setDeleting(true)
    setDeleteError(null)
    const id = project?.id || getStoredProjectId() || ''
    if (!id) {
      setDeleteError('No project selected.')
      setDeleting(false)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm_name: deleteInput }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDeleteError(
          body?.message || body?.detail?.message || `Delete failed (${res.status})`,
        )
        return
      }
      clearStoredProject()
      router.push('/')
      router.refresh()
    } catch {
      setDeleteError('Could not reach the server.')
    } finally {
      setDeleting(false)
    }
  }

  const displayName =
    project?.name || getStoredProjectName() || projectName || 'Project'
  const projectId =
    project?.project_id || project?.slug || stats?.project?.project_id || '—'
  const createdAt = project?.created_at || stats?.project?.created_at || null
  const connectionString = `project: ${projectId}  ·  id: ${project?.id?.slice(0, 8) || '—'}…`

  return (
    <PyroCoreLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Managing <span className="text-foreground font-medium">{displayName}</span>
            {loading ? ' · loading…' : ''}
          </p>
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
                  <label className="block text-sm font-medium text-foreground mb-2">Project ID (slug)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {projectId}
                    </code>
                    <button
                      onClick={() => copyToClipboard(String(projectId))}
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
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !projectName.trim()}
                    className="btn-primary min-h-[44px] disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  {saveMsg && (
                    <p className="text-sm" style={{ color: saveMsg === 'Saved.' ? 'var(--success)' : 'var(--error)' }}>
                      {saveMsg}
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'database' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Connection</label>
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
                  <p className="text-xs text-muted-foreground mt-1">
                    Tables / files for this project only. Switch projects from the sidebar.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Tables', value: stats?.table_count ?? '—' },
                    { label: 'Files', value: stats?.file_count ?? '—' },
                    { label: 'API keys', value: stats?.key_count ?? '—' },
                    {
                      label: 'DB size',
                      value: stats
                        ? `${(stats.db_size_bytes / 1024).toFixed(1)} KB`
                        : '—',
                    },
                  ].map((c) => (
                    <div key={c.label} className="p-3 border border-border">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className="text-lg font-semibold text-foreground mt-1">{c.value}</p>
                    </div>
                  ))}
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
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary min-h-[44px] disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
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
                  <label className="block text-sm font-medium text-foreground mb-2">Project-scoped data URL</label>
                  <code className="block px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                    {API_BASE}/api/projects/{projectId}/…
                  </code>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">API Keys</label>
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {stats?.key_count ?? 0} key(s) for this project. Manage on the{' '}
                    <a href="/api-keys" className="underline hover:text-foreground" style={{ color: 'var(--pyro-orange)' }}>API Keys</a> page.
                  </p>
                </div>
              </div>
            )}

            {tab === 'danger' && (
              <div className="space-y-6 border-t-2 border-error pt-6">
                <div className="p-4 bg-error/10 border border-error">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-error flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-error mb-1">Danger Zone</h3>
                      <p className="text-xs text-error/80">
                        Deletes <strong>{displayName}</strong> and its data. You cannot delete your last active project.
                      </p>
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
                      <span className="font-mono text-accent">{confirmName || '—'}</span>
                    </p>
                    <input
                      type="text"
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      placeholder="Type project name..."
                      className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-error min-h-[44px]"
                    />
                    {deleteError && (
                      <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
                        {deleteError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => { setDeleteConfirm(false); setDeleteInput(''); setDeleteError(null) }}
                        className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={deleteInput !== confirmName || !confirmName || deleting}
                        onClick={handleDelete}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors min-h-[44px] ${
                          deleteInput === confirmName && confirmName && !deleting
                            ? 'bg-error text-error-foreground hover:bg-error/90'
                            : 'bg-muted text-muted-foreground cursor-not-allowed'
                        }`}
                      >
                        {deleting ? 'Deleting…' : 'Delete Project'}
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
