'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Copy, Trash2, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react'

interface ApiKey {
  id: string
  name: string
  key: string
  masked: string
  scopes: string[]
  created: string
  lastUsed: string | null
}

const apiKeys: ApiKey[] = [
  { id: '1', name: 'Production API', key: 'pyro_live_a1b2c3d4e5f6g7h8i9j0', masked: 'pyro_live_••••••••i9j0', scopes: ['Read', 'Write'], created: '2024-01-15', lastUsed: '2024-02-20 14:32' },
  { id: '2', name: 'Development', key: 'pyro_dev_x1y2z3a4b5c6d7e8f9g0', masked: 'pyro_dev_••••••••f9g0', scopes: ['Read', 'Write', 'Admin'], created: '2024-01-10', lastUsed: '2024-02-19 10:15' },
  { id: '3', name: 'Backup Service', key: 'pyro_backup_k1l2m3n4o5p6q7r8s9t0', masked: 'pyro_backup_••••••••s9t0', scopes: ['Read'], created: '2024-02-01', lastUsed: null },
]

export default function APIKeysPage() {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showGeneratedKey, setShowGeneratedKey] = useState<string | null>(null)
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', scopes: { read: false, write: false, admin: false } })

  const handleGenerate = () => {
    const newKey = `pyro_live_${Math.random().toString(36).substr(2, 18)}`
    setShowGeneratedKey(newKey)
    setFormData({ name: '', scopes: { read: false, write: false, admin: false } })
  }

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text) }

  return (
    <PyroCoreLayout>
      <div className="max-w-4xl space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">API Keys</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage authentication tokens for your API</p>
          </div>
          <button onClick={() => setShowCreateForm(true)} className="btn-primary flex-shrink-0 min-h-[44px]">
            Create API Key
          </button>
        </div>

        {/* Keys list */}
        <div className="space-y-3">
          {apiKeys.map((key) => {
            const isExpanded = expandedKey === key.id
            return (
              <div key={key.id} className="bg-card border border-border overflow-hidden">
                {/* ── PRIMARY ROW — name + masked key + revoke ── */}
                <div className="p-4 lg:p-6">
                  {/* Top: name + revoke */}
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground">{key.name}</h3>
                    <button
                      onClick={() => setRevokeConfirm(key.id)}
                      className="px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors min-h-[44px] flex items-center"
                    >
                      Revoke
                    </button>
                  </div>

                  {/* Masked key — always visible */}
                  <div className="flex items-center gap-2 bg-background border border-border p-3 mb-3">
                    <code className="flex-1 text-sm font-mono text-foreground truncate">{key.masked}</code>
                    <button
                      onClick={() => copyToClipboard(key.key)}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Copy full key"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Desktop metadata — always visible on desktop */}
                  <div className="hidden lg:grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Scopes</p>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span key={scope} className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">{scope}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Created</p>
                      <p className="font-mono text-foreground">{key.created}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Last Used</p>
                      <p className="font-mono text-foreground">{key.lastUsed || '—'}</p>
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

                {/* Mobile expanded metadata */}
                {isExpanded && (
                  <div className="lg:hidden border-t border-border px-4 pb-4 pt-3 bg-muted/10">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Scopes</p>
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.map((scope) => (
                            <span key={scope} className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">{scope}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Created</p>
                        <p className="font-mono text-foreground text-xs">{key.created}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Last Used</p>
                        <p className="font-mono text-foreground text-xs">{key.lastUsed || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CREATE KEY MODAL — full-screen on mobile ── */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-md flex flex-col max-h-full overflow-y-auto">

            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-0 flex-shrink-0">
              <h2 className="text-lg font-semibold text-foreground">Create API Key</h2>
              <button onClick={() => { setShowCreateForm(false); setShowGeneratedKey(null) }} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!showGeneratedKey ? (
              <>
                <div className="flex-1 p-6 space-y-4 overflow-y-auto">
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
                      {['read', 'write', 'admin'].map((scope) => (
                        <label key={scope} className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={formData.scopes[scope as keyof typeof formData.scopes]}
                            onChange={(e) => setFormData({ ...formData, scopes: { ...formData.scopes, [scope]: e.target.checked } })}
                            className="w-4 h-4"
                          />
                          <span className="text-sm text-foreground capitalize">{scope}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Primary action pinned to bottom */}
                <div className="flex gap-3 p-6 border-t border-border flex-shrink-0">
                  <button onClick={() => setShowCreateForm(false)} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">Cancel</button>
                  <button onClick={handleGenerate} className="flex-1 btn-primary min-h-[44px]">Generate</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 p-6 space-y-4">
                  <div className="bg-warning/10 border border-warning/30 p-4 flex gap-3">
                    <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                    <p className="text-sm text-warning-foreground">Copy this now — you won&apos;t be able to see it again.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-2">API Key</label>
                    <div className="flex items-center gap-2 bg-background border border-border p-3">
                      <code className="flex-1 text-sm font-mono text-foreground break-all">{showGeneratedKey}</code>
                      <button onClick={() => copyToClipboard(showGeneratedKey)} className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-border flex-shrink-0">
                  <button onClick={() => { setShowCreateForm(false); setShowGeneratedKey(null) }} className="w-full btn-primary min-h-[44px]">Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── REVOKE MODAL — full-screen on mobile ── */}
      {revokeConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Revoke API Key</h2>
              <button onClick={() => setRevokeConfirm(null)} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground px-6 pb-6">Any applications using this key will no longer be able to access your API.</p>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setRevokeConfirm(null)} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">Cancel</button>
              <button onClick={() => setRevokeConfirm(null)} className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px]">Revoke</button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
