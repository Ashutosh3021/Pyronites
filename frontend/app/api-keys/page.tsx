'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, AlertCircle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import {
  apiUrl,
  getStoredProjectName,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertBanner } from '@/components/alert-banner'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string
  name: string
  masked: string        // e.g. "pyro_live_••••••••i9j0"
  scopes: string[]
  created_at: string
  last_used_at: string | null
}

interface CreateForm {
  name: string
  scopes: { read: boolean; write: boolean; admin: boolean }
}

const EMPTY_FORM: CreateForm = {
  name: '',
  scopes: { read: false, write: false, admin: false },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mask a raw key so only the prefix + last 4 chars are visible. */
function maskKey(raw: string): string {
  const prefix = raw.slice(0, 12)   // e.g. "pyro_live_ab"
  const suffix = raw.slice(-4)       // last 4
  return `${prefix}••••••••${suffix}`
}

/** Format an ISO timestamp for display. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function APIKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState<CreateForm>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // After a successful create the server returns the raw key exactly once.
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // ── Fetch keys ────────────────────────────────────────────────────────────
  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(apiUrl('/api/keys'), { credentials: 'include' })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data: ApiKey[] = await res.json()
      setKeys(data)
    } catch {
      setFetchError('Could not load API keys. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  // ── Create key ────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    const selectedScopes = (Object.keys(formData.scopes) as Array<keyof typeof formData.scopes>)
      .filter((s) => formData.scopes[s])

    if (!formData.name.trim()) {
      setCreateError('A name is required.')
      return
    }
    if (selectedScopes.length === 0) {
      setCreateError('Select at least one scope.')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch(apiUrl('/api/keys'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: formData.name.trim(), scopes: selectedScopes }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setCreateError(body?.message ?? `Server error (${res.status}).`)
        return
      }
      const body = await res.json()
      // The server returns { key: string (raw), ...metadata }
      const rawKey: string = body.key
      setRevealedKey(rawKey)
      setFormData(EMPTY_FORM)
      // Append the new key (masked) to local state immediately
      setKeys((prev) => [
        ...prev,
        {
          id: body.id,
          name: body.name,
          masked: maskKey(rawKey),
          scopes: body.scopes,
          created_at: body.created_at,
          last_used_at: null,
        },
      ])
    } catch {
      setCreateError('Could not reach the server. Try again.')
    } finally {
      setCreating(false)
    }
  }

  const closeCreateModal = () => {
    setShowCreateForm(false)
    setRevealedKey(null)
    setCreateError(null)
    setCopied(false)
    setFormData(EMPTY_FORM)
  }

  const copyKey = async () => {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text for manual copy
      setCreateError('Failed to copy. Please select and copy manually.')
    }
  }

  // ── Revoke key ────────────────────────────────────────────────────────────
  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setRevokeError(null)
    try {
      const res = await fetch(apiUrl(`/api/keys/${revokeTarget.id}`), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setRevokeError(body?.message ?? `Server error (${res.status}).`)
        return
      }
      setKeys((prev) => prev.filter((k) => k.id !== revokeTarget.id))
      setRevokeTarget(null)
    } catch {
      setRevokeError('Could not reach the server. Try again.')
    } finally {
      setRevoking(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <PyroCoreLayout>
      <div className="max-w-4xl space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">API Keys</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage authentication tokens for your API</p>
          </div>
          <Button onClick={() => setShowCreateForm(true)}>
            Create API Key
          </Button>
        </div>

        {/* Loading / error / empty states */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading keys…
          </div>
        )}
        {!loading && fetchError && <AlertBanner variant="error" message={fetchError} onDismiss={() => setFetchError(null)} />}
        {!loading && !fetchError && keys.length === 0 && (
          <p className="text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
        )}

        {/* Keys list */}
        {!loading && keys.length > 0 && (
          <div className="space-y-3">
            {keys.map((key) => {
              const isExpanded = expandedKey === key.id
              return (
                <Card key={key.id}>
                  <CardContent className="p-4 lg:p-6">
                    {/* Name + revoke */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground">{key.name}</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setRevokeTarget(key); setRevokeError(null) }}
                        className="text-error hover:text-error hover:bg-error/10"
                      >
                        Revoke
                      </Button>
                    </div>

                    {/* Masked key */}
                    <div className="flex items-center gap-2 bg-background border border-border p-3 mb-3 rounded-md">
                      <code className="flex-1 text-sm font-mono text-foreground truncate">{key.masked}</code>
                    </div>

                    {/* Desktop metadata */}
                    <div className="hidden lg:grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Scopes</p>
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((s) => (
                            <Badge key={s} variant="secondary" className="capitalize">{s}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Created</p>
                        <p className="font-mono text-xs text-foreground">{fmtDate(key.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Last Used</p>
                        <p className="font-mono text-xs text-foreground">{fmtDate(key.last_used_at)}</p>
                      </div>
                    </div>

                    {/* Mobile expand toggle */}
                    <button
                      onClick={() => setExpandedKey(isExpanded ? null : key.id)}
                      className="lg:hidden flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
                    >
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {isExpanded ? 'Less' : 'Scopes & dates'}
                    </button>
                  </CardContent>

                  {/* Mobile expanded */}
                  {isExpanded && (
                    <div className="lg:hidden border-t border-border px-4 pb-4 pt-3 bg-muted/10">
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Scopes</p>
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.map((s) => (
                              <Badge key={s} variant="secondary" className="capitalize">{s}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Created</p>
                          <p className="font-mono text-xs text-foreground">{fmtDate(key.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Last Used</p>
                          <p className="font-mono text-xs text-foreground">{fmtDate(key.last_used_at)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── CREATE MODAL ── */}
      <Dialog open={showCreateForm} onOpenChange={(isOpen) => !isOpen && closeCreateModal()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Generate a new API key for authentication.</DialogDescription>
          </DialogHeader>

          {/* Step A: form */}
          {!revealedKey ? (
            <>
              <div className="space-y-4 py-4">
                {createError && <AlertBanner variant="error" message={createError} onDismiss={() => setCreateError(null)} />}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Production API"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Scopes</label>
                  <div className="space-y-2">
                    {(['read', 'write', 'admin'] as const).map((scope) => (
                      <label key={scope} className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                        <input
                          type="checkbox"
                          checked={formData.scopes[scope]}
                          onChange={(e) =>
                            setFormData({ ...formData, scopes: { ...formData.scopes, [scope]: e.target.checked } })
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-sm text-foreground capitalize">{scope}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreateModal}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : 'Generate'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            /* Step B: show raw key once */
            <>
              <div className="space-y-4 py-4">
                <AlertBanner
                  variant="warning"
                  message="Copy this key now — it won't be shown again."
                />
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">API Key</label>
                  <div className="flex items-center gap-2 bg-background border border-border p-3 rounded-md">
                    <code className="flex-1 text-sm font-mono text-foreground break-all">{revealedKey}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={copyKey}
                      aria-label="Copy API key"
                    >
                      {copied
                        ? <Check className="w-4 h-4 text-success" />
                        : <Copy className="w-4 h-4" />
                      }
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeCreateModal} className="w-full">Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── REVOKE MODAL ── */}
      <Dialog open={!!revokeTarget} onOpenChange={(isOpen) => !isOpen && setRevokeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The key will be immediately revoked and any applications using it will lose access.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{revokeTarget?.name}</span> will be permanently revoked.
            </p>
            {revokeError && <AlertBanner variant="error" message={revokeError} onDismiss={() => setRevokeError(null)} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevokeTarget(null); setRevokeError(null) }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Revoking…</> : 'Revoke'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PyroCoreLayout>
  )
}
