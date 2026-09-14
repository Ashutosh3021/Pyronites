'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Lock, Unlock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
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
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Authentication</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your app&apos;s end-users and sessions</p>
        </div>

        {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}
        {actionErr && <AlertBanner variant="error" message={actionErr} onDismiss={() => setActionErr(null)} />}

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
          {[
            { label: 'Total Users', value: String(users.length) },
            { label: 'Active Now', value: String(activeCount) },
            { label: 'Sessions', value: String(sessions.length) },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
                <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <div className="overflow-hidden">
                {users.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    {loading ? 'Loading…' : 'No users yet.'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Last Sign-In</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-mono">{user.email}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{user.created}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{user.lastSignIn}</TableCell>
                          <TableCell>
                            <Badge variant={user.status === 'active' ? 'success' : 'secondary'}>
                              {user.status === 'active' ? 'Active' : 'Disabled'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleActive(user)}
                                disabled={busy}
                                aria-label={user.status === 'active' ? 'Disable user' : 'Enable user'}
                              >
                                {user.status === 'active' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setConfirmDelete(user)}
                                disabled={busy}
                                aria-label="Delete user"
                                className="text-error hover:text-error"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="sessions">
            <Card>
              <div className="overflow-hidden">
                {sessions.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    {loading ? 'Loading…' : 'No active sessions'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User Email</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => (
                        <TableRow key={session.id}>
                          <TableCell className="font-mono">{session.userEmail}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{session.created}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{session.expires}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => revokeSession(session.id)}
                              disabled={busy}
                              className="text-error hover:text-error hover:bg-error/10"
                            >
                              Revoke
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!confirmDelete} onOpenChange={(isOpen) => !isOpen && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The user and their sessions will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Permanently delete <span className="font-semibold text-foreground">{confirmDelete?.email}</span>?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && doDeleteUser(confirmDelete)}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PyroCoreLayout>
  )
}
