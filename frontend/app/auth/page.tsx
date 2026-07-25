'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { MoreVertical, Trash2, Lock, Unlock, ChevronDown, ChevronUp, X } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface RawUser {
  id: string
  email: string
  created_at: string
  is_active: boolean
}

interface RawSession {
  id: string
  user_email: string
  created_at: string
  expires_at: string
}

interface User {
  id: string
  email: string
  created: string
  lastSignIn: string
  status: 'active' | 'disabled'
}

interface Session {
  id: string
  userEmail: string
  created: string
  expires: string
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AuthenticationPage() {
  const [users, setUsers] = useState<User[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [tab, setTab] = useState<'users' | 'sessions'>('users')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const [uRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/users`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/sessions`, { credentials: 'include' }),
      ])
      if (!uRes.ok) throw new Error('users')
      const rawUsers = (await uRes.json()) as RawUser[]
      setUsers(rawUsers.map((u) => ({
        id: u.id,
        email: u.email,
        created: fmtDate(u.created_at),
        lastSignIn: '—',
        status: u.is_active ? 'active' : 'disabled',
      })))
      if (sRes.ok) {
        const rawSessions = (await sRes.json()) as RawSession[]
        setSessions(rawSessions.map((s) => ({
          id: s.id,
          userEmail: s.user_email,
          created: fmtDate(s.created_at),
          expires: fmtDate(s.expires_at),
        })))
      }
    } catch {
      setLoadErr('Could not load authentication data. Is the backend running on :8000?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleActive = async (user: User) => {
    setBusy(true)
    setActionErr(null)
    setOpenMenu(null)
    try {
      const res = await fetch(`${API_BASE}/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: user.status !== 'active' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Failed to update user')
      }
      await load()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to update user')
    } finally {
      setBusy(false)
    }
  }

  const doDeleteUser = async (user: User) => {
    setBusy(true)
    setActionErr(null)
    try {
      const res = await fetch(`${API_BASE}/api/users/${user.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Failed to delete user')
      }
      setConfirmDelete(null)
      await load()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to delete user')
    } finally {
      setBusy(false)
    }
  }

  const revokeSession = async (sessionId: string) => {
    setBusy(true)
    setActionErr(null)
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Failed to revoke session')
      }
      await load()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to revoke session')
    } finally {
      setBusy(false)
    }
  }

  const activeCount = users.filter((u) => u.status === 'active').length

  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Authentication</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your app&apos;s end-users and sessions</p>
          </div>
        </div>

        {loadErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>
        )}
        {actionErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{actionErr}</p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {[
            { label: 'Total Users', value: String(users.length) },
            { label: 'Active Now', value: String(activeCount) },
            { label: 'Sessions', value: String(sessions.length) },
            { label: 'This Month', value: '—' },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="border-b border-border flex gap-6 lg:gap-8">
          {(['users', 'sessions'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-3 font-medium text-sm border-b-2 transition-colors capitalize min-h-[44px] ${
                tab === t
                  ? 'border-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div className="bg-card border border-border overflow-hidden">
            {users.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                {loading ? 'Loading…' : 'No users yet.'}
              </div>
            ) : (
              <>
                <div className="hidden lg:grid lg:grid-cols-5 gap-4 px-6 py-4 border-b border-border bg-muted/30">
                  <div className="text-xs font-semibold text-foreground">Email</div>
                  <div className="text-xs font-semibold text-foreground">Created</div>
                  <div className="text-xs font-semibold text-foreground">Last Sign-In</div>
                  <div className="text-xs font-semibold text-foreground">Status</div>
                  <div className="text-xs font-semibold text-foreground">Actions</div>
                </div>

                {users.map((user) => {
                  const isExpanded = expandedRow === user.id
                  return (
                    <div key={user.id} className="border-b border-border">
                      <div className="hidden lg:grid lg:grid-cols-5 gap-4 px-6 py-4 hover:bg-muted/30 transition-colors items-center">
                        <div className="text-sm font-mono text-foreground">{user.email}</div>
                        <div className="text-sm font-mono text-muted-foreground">{user.created}</div>
                        <div className="text-sm font-mono text-muted-foreground">{user.lastSignIn}</div>
                        <div>
                          <span className={`inline-block px-2 py-1 text-xs font-medium ${
                            user.status === 'active' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                          }`}>
                            {user.status === 'active' ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setOpenMenu(openMenu === user.id ? null : user.id)}
                            className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                            disabled={busy}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {openMenu === user.id && (
                            <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-10 min-w-40 overflow-hidden">
                              <button
                                onClick={() => toggleActive(user)}
                                className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 min-h-[44px]"
                              >
                                {user.status === 'active' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                {user.status === 'active' ? 'Disable User' : 'Enable User'}
                              </button>
                              <button
                                onClick={() => { setConfirmDelete(user); setOpenMenu(null) }}
                                className="w-full px-4 py-3 text-left text-sm text-error hover:bg-error/10 transition-colors flex items-center gap-2 min-h-[44px]"
                              >
                                <Trash2 className="w-4 h-4" />Delete User
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="lg:hidden">
                        <button
                          onClick={() => setExpandedRow(isExpanded ? null : user.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left min-h-[56px]"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono text-foreground truncate">{user.email}</p>
                          </div>
                          <span className={`inline-block px-2 py-1 text-xs font-medium flex-shrink-0 ${
                            user.status === 'active' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                          }`}>
                            {user.status === 'active' ? 'Active' : 'Disabled'}
                          </span>
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          }
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-3 bg-muted/10 border-t border-border space-y-3">
                            <div className="grid grid-cols-2 gap-3 pt-3">
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Created</p>
                                <p className="text-sm font-mono text-foreground">{user.created}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Last Sign-In</p>
                                <p className="text-sm font-mono text-foreground">{user.lastSignIn}</p>
                              </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => toggleActive(user)}
                                disabled={busy}
                                className="flex items-center gap-2 px-3 py-2 border border-border text-sm text-foreground hover:bg-muted transition-colors min-h-[44px] flex-1 justify-center disabled:opacity-60"
                              >
                                {user.status === 'active' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                {user.status === 'active' ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(user)}
                                disabled={busy}
                                className="flex items-center gap-2 px-3 py-2 border border-error/30 text-sm text-error hover:bg-error/10 transition-colors min-h-[44px] flex-1 justify-center disabled:opacity-60"
                              >
                                <Trash2 className="w-4 h-4" />Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {tab === 'sessions' && (
          <div className="bg-card border border-border overflow-hidden">
            {sessions.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                {loading ? 'Loading…' : 'No active sessions'}
              </div>
            ) : (
              <>
                <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 border-b border-border bg-muted/30">
                  <div className="text-xs font-semibold text-foreground">User Email</div>
                  <div className="text-xs font-semibold text-foreground">Created</div>
                  <div className="text-xs font-semibold text-foreground">Expires</div>
                  <div className="text-xs font-semibold text-foreground">Action</div>
                </div>

                {sessions.map((session) => (
                  <div key={session.id} className="border-b border-border">
                    <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 hover:bg-muted/30 transition-colors items-center">
                      <div className="text-sm font-mono text-foreground">{session.userEmail}</div>
                      <div className="text-sm font-mono text-muted-foreground">{session.created}</div>
                      <div className="text-sm font-mono text-muted-foreground">{session.expires}</div>
                      <button
                        onClick={() => revokeSession(session.id)}
                        disabled={busy}
                        className="text-sm text-error hover:underline transition-colors w-fit min-h-[44px] flex items-center disabled:opacity-60"
                      >
                        Revoke
                      </button>
                    </div>

                    <div className="lg:hidden flex items-center gap-3 px-4 py-3 min-h-[56px]">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-foreground truncate">{session.userEmail}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Expires {session.expires}</p>
                      </div>
                      <button
                        onClick={() => revokeSession(session.id)}
                        disabled={busy}
                        className="text-sm text-error px-3 py-2 hover:bg-error/10 transition-colors flex-shrink-0 min-h-[44px] flex items-center disabled:opacity-60"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Delete User</h2>
              <button
                onClick={() => setConfirmDelete(null)}
                className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground px-6 pb-2">
              Permanently delete <span className="font-semibold text-foreground">{confirmDelete.email}</span>?
              Their sessions will also be removed. This cannot be undone.
            </p>
            <div className="flex gap-3 px-6 pb-6 pt-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={() => doDeleteUser(confirmDelete)}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px] disabled:opacity-70"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
