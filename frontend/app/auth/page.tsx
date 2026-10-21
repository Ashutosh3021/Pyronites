'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { useState, useEffect, useCallback } from 'react'
import { Lock, Unlock, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { AlertBanner } from '@/components/alert-banner'
import { apiUrl } from '@/lib/api'
import type { User, Session, RawUser, RawSession } from '@/lib/types'
import { fmtDate } from '@/lib/utils'

export default function AuthenticationPage() {
  const [users, setUsers] = useState<User[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
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
        fetch(apiUrl('/api/users'), { credentials: 'include' }),
        fetch(apiUrl('/api/sessions'), { credentials: 'include' }),
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
    try {
      const res = await fetch(apiUrl(`/api/users/${user.id}`), {
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
      const res = await fetch(apiUrl(`/api/users/${user.id}`), {
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
      const res = await fetch(apiUrl(`/api/sessions/${sessionId}`), {
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
      <PageHeader
        meta="People and sessions"
        title="Authentication"
        description="Dashboard accounts and live sessions. These belong to the instance, not to a project, so they span every project in it."
      />

      {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}
      {actionErr && <AlertBanner variant="error" message={actionErr} onDismiss={() => setActionErr(null)} />}

      <dl className="mt-8 grid grid-cols-2 lg:grid-cols-3 gap-px bg-seam border border-seam">
        {[
          { label: 'Accounts', value: String(users.length) },
          { label: 'Enabled', value: String(activeCount) },
          { label: 'Live sessions', value: String(sessions.length) },
        ].map((stat) => (
          <div key={stat.label} className="bg-plate p-5">
            <dt className="label">{stat.label}</dt>
            <dd className="data mt-3 text-[26px] leading-none text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <Tabs defaultValue="users" className="mt-10">
        <TabsList>
          <TabsTrigger value="users">Accounts</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card className="overflow-hidden">
            {users.length === 0 ? (
              <EmptyState
                icon={Users}
                title={loading ? 'Loading accounts' : 'No accounts yet'}
                description="An account appears here after the first sign-in on this instance."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="data text-[12px] text-ink">{user.email}</TableCell>
                      <TableCell className="data text-[12px] text-ink-muted">{user.created}</TableCell>
                      <TableCell className="data text-[12px] text-ink-muted">{user.lastSignIn}</TableCell>
                      <TableCell>
                        <Badge variant={user.status === 'active' ? 'success' : 'secondary'}>
                          {user.status === 'active' ? 'Active' : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => toggleActive(user)}
                            disabled={busy}
                            aria-label={user.status === 'active' ? `Disable ${user.email}` : `Enable ${user.email}`}
                          >
                            {user.status === 'active' ? (
                              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setConfirmDelete(user)}
                            disabled={busy}
                            aria-label={`Delete ${user.email}`}
                            className="text-error hover:text-error"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card className="overflow-hidden">
            {sessions.length === 0 ? (
              <EmptyState
                icon={Users}
                title={loading ? 'Loading sessions' : 'No live sessions'}
                description="Sessions are created when someone signs in and expire on their own."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="data text-[12px] text-ink">{session.userEmail}</TableCell>
                      <TableCell className="data text-[12px] text-ink-muted">{session.created}</TableCell>
                      <TableCell className="data text-[12px] text-ink-muted">{session.expires}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeSession(session.id)}
                          disabled={busy}
                          className="text-error hover:text-error"
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirmDelete} onOpenChange={(isOpen) => !isOpen && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This cannot be undone. The account and its sessions are removed from the instance.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-[13px] text-ink-muted">
              Permanently delete{' '}
              <span className="data text-ink">{confirmDelete?.email}</span>?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && doDeleteUser(confirmDelete)}
              disabled={busy}
            >
              {busy ? 'Deleting' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PyroCoreLayout>
  )
}
