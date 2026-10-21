'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Copy, HardDrive } from 'lucide-react'
import {
  getStoredProjectId,
  getStoredProjectName,
  setStoredProject,
  clearStoredProject,
  apiUrl,
  API_BASE,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { AlertBanner } from '@/components/alert-banner'
import { EmptyState } from '@/components/empty-state'

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
  const [tab, setTab] = useState('general')
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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback: could show a toast notification
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    setSaveMsg(null)
    const storedId = getStoredProjectId()

    try {
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
          setStoredProject({ id: detail.id, name: detail.name })
        }
      }

      const sRes = await fetch(apiUrl('/api/stats'), { credentials: 'include' })
      if (sRes.ok) {
        const s = (await sRes.json()) as Stats
        setStats(s)
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
      <PageHeader
        meta="Project configuration"
        title="Settings"
        description={`Managing ${displayName}${loading ? ', still loading' : ''}. These settings apply to this project only.`}
      />

      {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="w-full sm:w-auto justify-start">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardContent className="p-5 lg:p-6 space-y-6">
              <div className="space-y-2">
                <label htmlFor="project-name" className="block text-[13px] font-medium text-ink">
                  Project name
                </label>
                <Input
                  id="project-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink">Project id</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-plate-raised border border-seam data text-[12px] text-ink-muted truncate min-h-[44px] flex items-center">
                    {projectId}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(String(projectId))}
                    aria-label="Copy project id"
                  >
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink">Created</p>
                <p className="data text-[12px] text-ink-muted">{fmtDate(createdAt)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleSave} disabled={saving || !projectName.trim()}>
                  {saving ? 'Saving' : 'Save changes'}
                </Button>
                {saveMsg && (
                  <AlertBanner
                    variant={saveMsg === 'Saved.' ? 'success' : 'error'}
                    message={saveMsg}
                    onDismiss={() => setSaveMsg(null)}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="database">
          <Card>
            <CardContent className="p-5 lg:p-6 space-y-6">
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink">Connection</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-plate-raised border border-seam data text-[12px] text-ink-muted truncate min-h-[44px] flex items-center">
                    {connectionString}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(connectionString)}
                    aria-label="Copy connection string"
                  >
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
                <p className="data text-[11px] text-ink-faint mt-1">
                  Tables and files for this project only. Switch projects from the rail.
                </p>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-seam border border-seam">
                {[
                  { label: 'Tables', value: stats?.table_count ?? '—' },
                  { label: 'Files', value: stats?.file_count ?? '—' },
                  { label: 'API keys', value: stats?.key_count ?? '—' },
                  {
                    label: 'DB size',
                    value: stats ? `${(stats.db_size_bytes / 1024).toFixed(1)} KB` : '—',
                  },
                ].map((c) => (
                  <div key={c.label} className="bg-plate p-3">
                    <dt className="label">{c.label}</dt>
                    <dd className="data text-[17px] text-ink mt-2">{c.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex items-center justify-between p-4 border border-seam bg-plate-raised/50">
                <div>
                  <h3 className="text-[13px] font-medium text-ink">Write-Ahead Logging</h3>
                  <p className="text-[12px] text-ink-muted mt-1">
                    Always on. It improves concurrency and durability for concurrent writers.
                  </p>
                </div>
                <span
                  className="data text-[11px] text-success flex-shrink-0 border border-success/40 bg-success/10 px-2 py-1"
                  aria-label="Write-Ahead Logging is always enabled"
                >
                  Enabled
                </span>
              </div>

              <div className="space-y-2">
                <label htmlFor="backup-interval" className="block text-[13px] font-medium text-ink">
                  Backup interval
                </label>
                <Select value={backupInterval} onValueChange={setBackupInterval}>
                  <SelectTrigger id="backup-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15min">Every 15 minutes</SelectItem>
                    <SelectItem value="1hour">Every 1 hour</SelectItem>
                    <SelectItem value="6hours">Every 6 hours</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={handleBackup} disabled={backingUp}>
                  {backingUp ? 'Backing up' : 'Back up now'}
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving' : 'Save changes'}
                </Button>
              </div>

              {backupMsg && (
                <AlertBanner
                  variant={backupMsg.includes('failed') || backupMsg.includes('Error') ? 'error' : 'success'}
                  message={backupMsg}
                  onDismiss={() => setBackupMsg(null)}
                />
              )}

              <div>
                <h3 className="text-[13px] font-semibold text-ink mb-3">Recent backups</h3>
                {backups.length === 0 ? (
                  <EmptyState
                    compact
                    icon={HardDrive}
                    title="No backups yet"
                    description="Backups also run automatically on a schedule. Run one now to make the first."
                    action={{ label: 'Back up now', onClick: handleBackup, disabled: backingUp }}
                  />
                ) : (
                  <ul className="space-y-2">
                    {backups.map((b) => (
                      <li
                        key={b.name}
                        className="flex items-center justify-between px-3 py-2 border border-seam data text-[12px] min-h-[44px]"
                      >
                        <span className="text-ink-muted truncate">{b.name}</span>
                        <span className="text-ink-faint flex-shrink-0 ml-2">{fmtDate(b.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api">
          <Card>
            <CardContent className="p-5 lg:p-6 space-y-6">
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink">Base URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-plate-raised border border-seam data text-[12px] text-ink-muted truncate min-h-[44px] flex items-center">
                    {API_BASE}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(API_BASE)}
                    aria-label="Copy base URL"
                  >
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink">Project-scoped data URL</p>
                <code className="block px-3 py-2 bg-plate-raised border border-seam data text-[12px] text-ink-muted truncate min-h-[44px] flex items-center">
                  {API_BASE}/api/projects/{projectId}/...
                </code>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink">API keys</p>
                <p className="text-[13px] text-ink-muted">
                  {stats?.key_count ?? 0} keys for this project.{' '}
                  <Link href="/api-keys" className="link">
                    Manage them
                  </Link>
                  .
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger">
          <Card style={{ boxShadow: 'inset 2px 0 0 0 var(--error)' }}>
            <CardContent className="p-5 lg:p-6 space-y-6">
              <AlertBanner
                variant="error"
                message={`Deletes ${displayName} and its data. You cannot delete your last active project.`}
              />

              {!deleteConfirm ? (
                <Button variant="destructive" onClick={() => setDeleteConfirm(true)}>
                  Delete project
                </Button>
              ) : (
                <div className="space-y-4 p-4 border border-error/40">
                  <p className="text-[13px] text-ink">
                    To confirm, type the project name:{' '}
                    <span className="data text-accent">{confirmName || 'none'}</span>
                  </p>
                  <Input
                    type="text"
                    value={deleteInput}
                    onChange={(e) => setDeleteInput(e.target.value)}
                    placeholder="Type the project name"
                    aria-label="Type the project name to confirm deletion"
                    className="focus-visible:border-error focus-visible:ring-error"
                  />
                  {deleteError && <AlertBanner variant="error" message={deleteError} onDismiss={() => setDeleteError(null)} />}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={() => { setDeleteConfirm(false); setDeleteInput(''); setDeleteError(null) }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={deleteInput !== confirmName || !confirmName || deleting}
                      onClick={handleDelete}
                      className="flex-1"
                    >
                      {deleting ? 'Deleting' : 'Delete project'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PyroCoreLayout>
  )
}
