'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, AlertCircle, ChevronDown, ChevronUp, X, RefreshCw } from 'lucide-react'

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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

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
      const res = await fetch(`${API_BASE}/api/keys`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data: ApiKey[] = await res.json()
      setKeys(data)
    } catch (err) {
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
      const res = await fetch(`${API_BASE}/api/keys`, {
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

  const copyKey = () => {
    if (!revealedKey) return
    navigator.clipboard.writeText(revealedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Revoke key ────────────────────────────────────────────────────────────
  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setRevokeError(null)
    try {
      const res = await fetch(`${API_BASE}/api/keys/${revokeTarget.id}`, {
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
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-primary flex-shrink-0 min-h-[44px]"
          >
            Create API Key
          </button>
        </div>

        {/* Loading / error / empty states */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading keys…
          </div>
        )}
        {!loading && fetchError && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{fetchError}</p>
        )}
        {!loading && !fetchError && keys.length === 0 && (
          <p className="text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
        )}

        {/* Keys list */}
        {!loading && keys.length > 0 && (
          <div className="space-y-3">
            {keys.map((key) => {
              const isExpanded = expandedKey === key.id
              return (
                <div key={key.id} className="bg-card border border-border overflow-hidden">
                  <div className="p-4 lg:p-6">
                    {/* Name + revoke */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground">{key.name}</h3>
                      <button
                        onClick={() => { setRevokeTarget(key); setRevokeError(null) }}
                        className="px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors min-h-[44px] flex items-center"
                      >
                        Revoke
                      </button>
                    </div>

                    {/* Masked key */}
                    <div className="flex items-center gap-2 bg-background border border-border p-3 mb-3">
                      <code className="flex-1 text-sm font-mono text-foreground truncate">{key.masked}</code>
                    </div>

                    {/* Desktop metadata */}
                    <div className="hidden lg:grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Scopes</p>
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((s) => (
                            <span key={s} className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground capitalize">{s}</span>
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
                  </div>

                  {/* Mobile expanded */}
                  {isExpanded && (
                    <div className="lg:hidden border-t border-border px-4 pb-4 pt-3 bg-muted/10">
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Scopes</p>
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.map((s) => (
                              <span key={s} className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground capitalize">{s}</span>
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
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── CREATE MODAL ── */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-md flex flex-col max-h-full overflow-y-auto">

            <div className="flex items-center justify-between p-6 pb-0 flex-shrink-0">
              <h2 className="text-lg font-semibold text-foreground">Create API Key</h2>
              <button onClick={closeCreateModal} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step A: form */}
            {!revealedKey ? (
              <>
                <div className="flex-1 p-6 space-y-4 overflow-y-auto">
                  {createError && (
                    <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{createError}</p>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Production API"
                      className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-3">Scopes</label>
                    <div className="space-y-1">
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
                <div className="flex gap-3 p-6 border-t border-border flex-shrink-0">
                  <button onClick={closeCreateModal} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex-1 btn-primary min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-70"
                  >
                    {creating ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" /> Creating…</>
                    ) : 'Generate'}
                  </button>
                </div>
              </>
            ) : (
              /* Step B: show raw key once */
              <>
                <div className="flex-1 p-6 space-y-4">
                  <div className="bg-warning/10 border border-warning/30 p-4 flex gap-3">
                    <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" aria-hidden="true" />
                    <p className="text-sm text-warning-foreground">Copy this now — it won&apos;t be shown again.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-2">API Key</label>
                    <div className="flex items-center gap-2 bg-background border border-border p-3">
                      <code className="flex-1 text-sm font-mono text-foreground break-all">{revealedKey}</code>
                      <button
                        onClick={copyKey}
                        className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        aria-label="Copy API key"
                      >
                        {copied
                          ? <Check className="w-4 h-4" style={{ color: 'var(--success)' }} />
                          : <Copy className="w-4 h-4" />
                        }
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-border flex-shrink-0">
                  <button onClick={closeCreateModal} className="w-full btn-primary min-h-[44px]">Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── REVOKE MODAL ── */}
      {revokeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Revoke API Key</h2>
              <button
                onClick={() => { setRevokeTarget(null); setRevokeError(null) }}
                className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground px-6 pb-2">
              <span className="font-semibold text-foreground">{revokeTarget.name}</span> will be permanently revoked.
              Any applications using it will immediately lose access.
            </p>
            {revokeError && (
              <p role="alert" className="text-sm px-6 pb-2" style={{ color: 'var(--error)' }}>{revokeError}</p>
            )}
            <div className="flex gap-3 px-6 pb-6 pt-2">
              <button
                onClick={() => { setRevokeTarget(null); setRevokeError(null) }}
                className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px] disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {revoking
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" /> Revoking…</>
                  : 'Revoke'
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
