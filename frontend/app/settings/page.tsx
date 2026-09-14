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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertBanner } from '@/components/alert-banner'

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
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Managing <span className="text-foreground font-medium">{displayName}</span>
            {loading ? ' · loading…' : ''}
          </p>
        </div>

        {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full sm:w-auto justify-start">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="database">Database</TabsTrigger>
            <TabsTrigger value="api">API</TabsTrigger>
            <TabsTrigger value="danger">Danger Zone</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <Card>
              <CardContent className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Project Name</label>
                  <Input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Project ID (slug)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {projectId}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(String(projectId))}
                      aria-label="Copy project ID"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Created</label>
                  <p className="px-3 py-2 text-sm text-muted-foreground">{fmtDate(createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSave}
                    disabled={saving || !projectName.trim()}
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
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
              <CardContent className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Connection</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {connectionString}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(connectionString)}
                      aria-label="Copy connection string"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
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
                    <div key={c.label} className="p-3 border border-border rounded-lg">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className="text-lg font-semibold text-foreground mt-1">{c.value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">WAL Mode</h3>
                    <p className="text-xs text-muted-foreground mt-1">Write-Ahead Logging improves concurrency and durability</p>
                  </div>
                  <div className="w-12 h-6 rounded-full relative flex-shrink-0 bg-success">
                    <div className="w-5 h-5 rounded-full bg-foreground absolute top-0.5 translate-x-6" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Backup Interval</label>
                  <Select value={backupInterval} onValueChange={setBackupInterval}>
                    <SelectTrigger>
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
                    {backingUp ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Backing up…</> : 'Back Up Now'}
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
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
                  <h3 className="text-sm font-semibold text-foreground mb-3">Recent Backups</h3>
                  {backups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No backups yet. Run one with "Back Up Now".</p>
                  ) : (
                    <div className="space-y-2">
                      {backups.map((b) => (
                        <div key={b.name} className="flex items-center justify-between px-3 py-2 border border-border rounded-lg text-sm min-h-[44px]">
                          <span className="font-mono text-muted-foreground truncate">{b.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{fmtDate(b.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api">
            <Card>
              <CardContent className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Base URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      {API_BASE}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(API_BASE)}
                      aria-label="Copy base URL"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Project-scoped data URL</label>
                  <code className="block px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                    {API_BASE}/api/projects/{projectId}/…
                  </code>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">API Keys</label>
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {stats?.key_count ?? 0} key(s) for this project. Manage on the{' '}
                    <a href="/api-keys" className="underline hover:text-foreground" style={{ color: 'var(--pyro-orange)' }}>API Keys</a> page.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger">
            <Card className="border-error/30">
              <CardContent className="p-6 space-y-6">
                <AlertBanner
                  variant="error"
                  message={`Deletes ${displayName} and its data. You cannot delete your last active project.`}
                />

                {!deleteConfirm ? (
                  <Button
                    variant="destructive"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    Delete Project
                  </Button>
                ) : (
                  <div className="space-y-4 p-4 border border-error/30 rounded-lg">
                    <p className="text-sm text-foreground">
                      To confirm, type the project name:{' '}
                      <span className="font-mono text-accent">{confirmName || '—'}</span>
                    </p>
                    <Input
                      type="text"
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      placeholder="Type project name..."
                      className="focus:border-error"
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
                        {deleting ? 'Deleting…' : 'Delete Project'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PyroCoreLayout>
  )
}
