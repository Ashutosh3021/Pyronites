'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertBanner } from '@/components/alert-banner'
import { apiUrl } from '@/lib/api'
import type { LogEntry } from '@/lib/types'
import { levelDotClass, levelBadgeClass, statusCodeClass } from '@/lib/utils'

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filterLevel, setFilterLevel] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLive, setIsLive] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/logs'), { credentials: 'include' })
      if (!res.ok) throw new Error('logs')
      setLogs((await res.json()) as LogEntry[])
    } catch {
      setLoadErr('Could not load logs. Is the backend running on :8000?')
    }
  }, [])

  useEffect(() => {
    load()

    // Visibility-aware polling
    const startPolling = () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(load, 3000)
    }

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    const handleVisibility = () => {
      if (isLive) {
        if (document.visibilityState === 'visible') {
          startPolling()
        } else {
          stopPolling()
        }
      }
    }

    // Start polling initially if live
    if (isLive) {
      startPolling()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [load, isLive])

  const filteredLogs = logs.filter((log) =>
    (filterLevel === 'all' || log.level === filterLevel) &&
    log.action.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <PyroCoreLayout>
      <div className="space-y-4 lg:space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Logs</h1>
            <p className="text-muted-foreground text-sm mt-1">View system events and activity</p>
          </div>
          <Button
            variant={isLive ? "default" : "outline"}
            onClick={() => setIsLive(!isLive)}
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 mr-2 ${isLive ? 'pulse-orange' : ''}`}
              style={{ backgroundColor: isLive ? 'var(--pyro-orange)' : 'var(--muted-foreground)' }}
            />
            {isLive ? 'Live' : 'Paused'}
          </Button>
        </div>

        {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

        <Card>
          <CardContent className="p-3 lg:p-4 flex flex-col sm:flex-row gap-3">
            <div className="flex gap-1.5 overflow-x-auto flex-shrink-0 pb-0.5 sm:pb-0">
              {['all', 'info', 'warning', 'error', 'success'].map((level) => (
                <Button
                  key={level}
                  variant={filterLevel === level ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterLevel(level)}
                  className="capitalize"
                >
                  {level}
                </Button>
              ))}
            </div>

            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <div className="overflow-hidden">
            {filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                {loadErr ? 'No logs available.' : 'No logs found'}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${levelDotClass(log.level)}`} />
                            <span className="text-xs font-mono text-muted-foreground">{log.timestamp?.replace('T', ' ').slice(0, 19)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={log.level === 'error' ? 'error' : log.level === 'warning' ? 'warning' : log.level === 'success' ? 'success' : 'info'}>
                            {log.level.charAt(0).toUpperCase() + log.level.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-foreground">{log.action}</TableCell>
                        <TableCell className="text-right text-sm font-mono text-muted-foreground">
                          {log.statusCode
                            ? <span className={statusCodeClass(log.statusCode)}>{log.statusCode}</span>
                            : '—'
                          }
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        </Card>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>Showing {filteredLogs.length} logs</div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
