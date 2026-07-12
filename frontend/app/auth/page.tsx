'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { MoreVertical, Trash2, Lock, ChevronDown, ChevronUp, X } from 'lucide-react'

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

const users: User[] = [
  { id: '1', email: 'alice@example.com', created: '2024-01-15', lastSignIn: '2024-02-20 14:32', status: 'active' },
  { id: '2', email: 'bob@example.com', created: '2024-01-18', lastSignIn: '2024-02-18 09:15', status: 'active' },
  { id: '3', email: 'charlie@example.com', created: '2024-02-01', lastSignIn: '2024-01-20 16:45', status: 'disabled' },
]

const sessions: Session[] = [
  { id: '1', userEmail: 'alice@example.com', created: '2024-02-20 14:32', expires: '2024-03-20 14:32' },
  { id: '2', userEmail: 'bob@example.com', created: '2024-02-18 09:15', expires: '2024-03-19 09:15' },
]

export default function AuthenticationPage() {
  const [tab, setTab] = useState<'users' | 'sessions'>('users')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null)

  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Authentication</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your app&apos;s end-users and sessions</p>
          </div>
          <button className="btn-primary flex-shrink-0 min-h-[44px]">Add User</button>
        </div>

        {/* Summary Stats — 2-up on mobile, 4-up on tablet+ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {[
            { label: 'Total Users', value: '3' },
            { label: 'Active Now', value: '2' },
            { label: 'Sessions', value: '2' },
            { label: 'This Month', value: '2' },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
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

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div className="bg-card border border-border overflow-hidden">
            {users.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground mb-4">No users yet.</p>
                <button className="btn-primary min-h-[44px]">Add User</button>
              </div>
            ) : (
              <>
                {/* Desktop column headers — hidden on mobile */}
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
                      {/* ── DESKTOP ROW ── */}
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
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {openMenu === user.id && (
                            <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-10 min-w-40 overflow-hidden">
                              <button className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 min-h-[44px]">
                                <Lock className="w-4 h-4" />Disable User
                              </button>
                              <button
                                onClick={() => { setDeleteConfirm(user.id); setOpenMenu(null) }}
                                className="w-full px-4 py-3 text-left text-sm text-error hover:bg-error/10 transition-colors flex items-center gap-2 min-h-[44px]"
                              >
                                <Trash2 className="w-4 h-4" />Delete User
                              </button>
                              <button className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors min-h-[44px]">
                                Reset Password
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── MOBILE ROW — email + status visible, rest expandable ── */}
                      <div className="lg:hidden">
                        {/* Primary row */}
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

                        {/* Expanded detail */}
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
                              <button className="flex items-center gap-2 px-3 py-2 border border-border text-sm text-foreground hover:bg-muted transition-colors min-h-[44px] flex-1 justify-center">
                                <Lock className="w-4 h-4" />Disable
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(user.id)}
                                className="flex items-center gap-2 px-3 py-2 border border-error/30 text-sm text-error hover:bg-error/10 transition-colors min-h-[44px] flex-1 justify-center"
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

        {/* ── SESSIONS TAB ── */}
        {tab === 'sessions' && (
          <div className="bg-card border border-border overflow-hidden">
            {sessions.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">No active sessions</p>
              </div>
            ) : (
              <>
                {/* Desktop headers */}
                <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 border-b border-border bg-muted/30">
                  <div className="text-xs font-semibold text-foreground">User Email</div>
                  <div className="text-xs font-semibold text-foreground">Created</div>
                  <div className="text-xs font-semibold text-foreground">Expires</div>
                  <div className="text-xs font-semibold text-foreground">Action</div>
                </div>

                {sessions.map((session) => (
                  <div key={session.id} className="border-b border-border">
                    {/* Desktop row */}
                    <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 hover:bg-muted/30 transition-colors items-center">
                      <div className="text-sm font-mono text-foreground">{session.userEmail}</div>
                      <div className="text-sm font-mono text-muted-foreground">{session.created}</div>
                      <div className="text-sm font-mono text-muted-foreground">{session.expires}</div>
                      <button
                        onClick={() => setRevokeConfirm(session.id)}
                        className="text-sm text-error hover:underline transition-colors w-fit min-h-[44px] flex items-center"
                      >
                        Revoke
                      </button>
                    </div>

                    {/* Mobile row — email + revoke always visible */}
                    <div className="lg:hidden flex items-center gap-3 px-4 py-3 min-h-[56px]">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-foreground truncate">{session.userEmail}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Expires {session.expires}</p>
                      </div>
                      <button
                        onClick={() => setRevokeConfirm(session.id)}
                        className="text-sm text-error px-3 py-2 hover:bg-error/10 transition-colors flex-shrink-0 min-h-[44px] flex items-center"
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

      {/* ── DELETE MODAL — full-screen on mobile ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Delete User</h2>
              <button onClick={() => setDeleteConfirm(null)} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground px-6 pb-6">This action cannot be undone. Are you sure?</p>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">Cancel</button>
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px]">Delete</button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
