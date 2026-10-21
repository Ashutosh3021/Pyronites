'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertBanner } from '@/components/alert-banner'
import { apiUrl } from '@/lib/api'
import type { LogEntry } from '@/lib/types'
import { statusCodeClass } from '@/lib/utils'

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
      <PageHeader
        meta="Event stream"
        title="Logs"
        description="Every request, write and error the container has recorded, newest first. The stream refreshes on its own while it is live."
        actions={
          <Button
            variant={isLive ? 'default' : 'outline'}
            onClick={() => setIsLive(!isLive)}
            aria-pressed={isLive}
          >
            <span
              className="w-2 h-2 rotate-45 flex-shrink-0 mr-2"
              style={{
                backgroundColor: isLive ? 'var(--accent)' : 'var(--ink-faint)',
              }}
              aria-hidden="true"
            />
            {isLive ? 'Live' : 'Paused'}
          </Button>
        }
      />

      {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

      <div className="mt-6 space-y-4 lg:space-y-6">
        <Card>
          <CardContent className="p-3 lg:p-4 flex flex-col sm:flex-row gap-3">
            <div className="flex gap-1.5 overflow-x-auto flex-shrink-0 pb-0.5 sm:pb-0" role="group" aria-label="Filter by level">
              {['all', 'info', 'warning', 'error', 'success'].map((level) => (
                <Button
                  key={level}
                  variant={filterLevel === level ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterLevel(level)}
                  className="capitalize"
                  aria-pressed={filterLevel === level}
                >
                  {level}
                </Button>
              ))}
            </div>

            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint pointer-events-none" aria-hidden="true" />
              <Input
                type="text"
                placeholder="Search logs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                aria-label="Search logs by action"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-hidden">
            {filteredLogs.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title={loadErr ? 'No logs available' : 'No logs match this filter'}
                description={
                  loadErr
                    ? 'The backend did not answer the request for the event log.'
                    : 'Clear the level filter or the search box to see the rest of the stream.'
                }
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id} className="row-seam" data-level={log.level}>
                        <TableCell>
                          <span className="data text-[12px] text-ink-muted">
                            {log.timestamp?.replace('T', ' ').slice(0, 19)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              log.level === 'error'
                                ? 'error'
                                : log.level === 'warning'
                                  ? 'warning'
                                  : log.level === 'success'
                                    ? 'success'
                                    : 'info'
                            }
                          >
                            {log.level}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[13px] text-ink">{log.action}</TableCell>
                        <TableCell className="text-right">
                          <span className="data text-[12px] text-ink-muted">
                            {log.statusCode ? (
                              <span className={statusCodeClass(log.statusCode)}>{log.statusCode}</span>
                            ) : (
                              '—'
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        </Card>

        <div className="flex items-center justify-between text-[12px] text-ink-faint">
          <div>
            Showing {filteredLogs.length} of {logs.length} events
          </div>
          <div className="data">{isLive ? 'Refreshing every 3s' : 'Stream paused'}</div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
