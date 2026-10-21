'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, ChevronDown, ChevronUp, RefreshCw, Key, Plus } from 'lucide-react'
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
import { EmptyState } from '@/components/empty-state'

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
      <PageHeader
        meta="Credentials"
        title="API keys"
        description="Keys are scoped to this project. A read key can query it, a write key can change it, and an admin key can do both and manage the project itself."
        actions={
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create API key
          </Button>
        }
      />

      {/* Loading / error / empty states */}
      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-ink-muted">
          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading keys
        </div>
      )}
      {!loading && fetchError && <AlertBanner variant="error" message={fetchError} onDismiss={() => setFetchError(null)} />}
      {!loading && !fetchError && keys.length === 0 && (
        <div className="plate">
          <EmptyState
            icon={Key}
            title="No API keys yet"
            description="A key is what lets the pyronites client talk to this project. Create one with the scopes your app needs, read and write is enough for day to day use."
            action={{ label: 'Create API key', onClick: () => setShowCreateForm(true) }}
          />
        </div>
      )}

      {/* Keys list */}
      {!loading && keys.length > 0 && (
        <div className="space-y-3">
          {keys.map((key) => {
            const isExpanded = expandedKey === key.id
            return (
              <Card key={key.id} className="plate--lit">
                <CardContent className="p-4 lg:p-6">
                  {/* Name + revoke */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <h2 className="text-[15px] font-semibold text-ink">{key.name}</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setRevokeTarget(key); setRevokeError(null) }}
                      className="text-error hover:text-error"
                    >
                      Revoke
                    </Button>
                  </div>

                  {/* Masked key */}
                  <div className="flex items-center gap-2 bg-plate-raised border border-seam p-3 mb-4">
                    <code className="flex-1 data text-[12px] text-ink truncate">{key.masked}</code>
                  </div>

                  {/* Desktop metadata */}
                  <dl className="hidden lg:grid grid-cols-3 gap-4">
                    <div>
                      <dt className="label mb-1.5">Scopes</dt>
                      <dd className="flex flex-wrap gap-1">
                        {key.scopes.map((s) => (
                          <Badge key={s} variant="secondary" className="capitalize">
                            {s}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt className="label mb-1.5">Created</dt>
                      <dd className="data text-[12px] text-ink">{fmtDate(key.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="label mb-1.5">Last used</dt>
                      <dd className="data text-[12px] text-ink">{fmtDate(key.last_used_at)}</dd>
                    </div>
                  </dl>

                  {/* Mobile expand toggle */}
                  <button
                    onClick={() => setExpandedKey(isExpanded ? null : key.id)}
                    aria-expanded={isExpanded}
                    className="lg:hidden flex items-center gap-2 text-[12.5px] text-ink-muted hover:text-ink transition-colors min-h-[44px]"
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {isExpanded ? 'Hide details' : 'Scopes and dates'}
                  </button>
                </CardContent>

                {/* Mobile expanded */}
                {isExpanded && (
                  <dl className="lg:hidden border-t border-seam px-4 pb-4 pt-3 grid grid-cols-3 gap-3">
                    <div>
                      <dt className="label mb-1.5">Scopes</dt>
                      <dd className="flex flex-wrap gap-1">
                        {key.scopes.map((s) => (
                          <Badge key={s} variant="secondary" className="capitalize">
                            {s}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt className="label mb-1.5">Created</dt>
                      <dd className="data text-[12px] text-ink">{fmtDate(key.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="label mb-1.5">Last used</dt>
                      <dd className="data text-[12px] text-ink">{fmtDate(key.last_used_at)}</dd>
                    </div>
                  </dl>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ── CREATE MODAL ── */}
      <Dialog open={showCreateForm} onOpenChange={(isOpen) => !isOpen && closeCreateModal()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The raw key is shown once, right after it is generated. Store it before you close this.
            </DialogDescription>
          </DialogHeader>

          {/* Step A: form */}
          {!revealedKey ? (
            <>
              <div className="space-y-4 py-4">
                {createError && <AlertBanner variant="error" message={createError} onDismiss={() => setCreateError(null)} />}
                <div className="space-y-2">
                  <label htmlFor="key-name" className="block text-[13px] font-medium text-ink">
                    Name
                  </label>
                  <Input
                    id="key-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Production API"
                  />
                </div>
                <div className="space-y-2">
                  <fieldset>
                    <legend className="text-[13px] font-medium text-ink">Scopes</legend>
                    <div className="space-y-1 mt-1">
                      {(['read', 'write', 'admin'] as const).map((scope) => (
                        <label key={scope} className="flex items-center gap-3 cursor-pointer min-h-[40px]">
                          <input
                            type="checkbox"
                            checked={formData.scopes[scope]}
                            onChange={(e) =>
                              setFormData({ ...formData, scopes: { ...formData.scopes, [scope]: e.target.checked } })
                            }
                            className="w-4 h-4 accent-[var(--accent)]"
                          />
                          <span className="text-[13px] text-ink capitalize">{scope}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreateModal}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? 'Generating' : 'Generate'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            /* Step B: show raw key once */
            <>
              <div className="space-y-4 py-4">
                <AlertBanner
                  variant="warning"
                  message="Copy this key now. It is not shown again after this dialog closes."
                />
                <div className="space-y-2">
                  <p className="label">API key</p>
                  <div className="flex items-center gap-2 bg-plate-raised border border-seam p-3">
                    <code className="flex-1 data text-[12px] text-ink break-all">{revealedKey}</code>
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
            <DialogTitle>Revoke API key</DialogTitle>
            <DialogDescription>
              The key stops working the moment you confirm. Any application still using it loses
              access to this project.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-[13px] text-ink-muted">
              <span className="text-ink font-medium">{revokeTarget?.name}</span> will be revoked.
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
