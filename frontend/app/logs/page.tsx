'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Calendar } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success'
  action: string
  statusCode?: number
}

const levelDotClass = (level: string) => {
  switch (level) {
    case 'error':   return 'bg-error'
    case 'warning': return 'bg-warning'
    case 'success': return 'bg-success'
    default:        return 'bg-info'
  }
}

const levelBadgeClass = (level: string) => {
  switch (level) {
    case 'error':   return 'bg-error/15 text-error'
    case 'warning': return 'bg-warning/15 text-warning'
    case 'success': return 'bg-success/15 text-success'
    default:        return 'bg-info/15 text-info'
  }
}

const statusCodeClass = (code: number) => {
  if (code >= 200 && code < 300) return 'text-success'
  if (code >= 400 && code < 500) return 'text-warning'
  if (code >= 500)               return 'text-error'
  return ''
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filterLevel, setFilterLevel] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLive, setIsLive] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs`, { credentials: 'include' })
      if (!res.ok) throw new Error('logs')
      setLogs((await res.json()) as LogEntry[])
    } catch {
      setLoadErr('Could not load logs. Is the backend running on :8000?')
    }
  }, [])

  useEffect(() => {
    load()
    if (isLive) {
      pollRef.current = setInterval(load, 3000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
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
          <button
            onClick={() => setIsLive(!isLive)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors flex-shrink-0 min-h-[44px]"
            style={isLive
              ? { backgroundColor: 'rgba(255,106,0,0.12)', color: 'var(--pyro-orange)' }
              : { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }
            }
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'pulse-orange' : ''}`}
              style={{ backgroundColor: isLive ? 'var(--pyro-orange)' : 'var(--muted-foreground)' }}
            />
            {isLive ? 'Live' : 'Paused'}
          </button>
        </div>

        {loadErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>
        )}

        <div className="bg-card border border-border p-3 lg:p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex gap-1.5 overflow-x-auto flex-shrink-0 pb-0.5 sm:pb-0">
            {['all', 'info', 'warning', 'error', 'success'].map((level) => (
              <button
                key={level}
                onClick={() => setFilterLevel(level)}
                className={`px-3 py-2 text-xs font-medium transition-colors capitalize whitespace-nowrap min-h-[36px] flex-shrink-0 ${
                  filterLevel === level
                    ? 'bg-accent text-accent-foreground'
                    : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-1 min-w-0">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent min-h-[44px]"
              />
            </div>
            <button className="flex items-center gap-2 px-3 py-2 border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0 min-h-[44px]">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Last 24h</span>
            </button>
          </div>
        </div>

        <div className="bg-card border border-border overflow-hidden">
          {filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              {loadErr ? 'No logs available.' : 'No logs found'}
            </div>
          ) : (
            <>
              <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 border-b border-border bg-muted/30">
                <div className="text-xs font-semibold text-foreground">Timestamp</div>
                <div className="text-xs font-semibold text-foreground">Level</div>
                <div className="text-xs font-semibold text-foreground">Action</div>
                <div className="text-xs font-semibold text-foreground">Details</div>
              </div>

              {filteredLogs.map((log) => (
                <div key={log.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 items-center">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${levelDotClass(log.level)}`} />
                      <span className="text-xs font-mono text-muted-foreground">{log.timestamp?.replace('T', ' ').slice(0, 19)}</span>
                    </div>
                    <div>
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium capitalize ${levelBadgeClass(log.level)}`}>
                        {log.level.charAt(0).toUpperCase() + log.level.slice(1)}
                      </span>
                    </div>
                    <div className="text-sm text-foreground">{log.action}</div>
                    <div className="text-sm font-mono text-muted-foreground">
                      {log.statusCode
                        ? <span className={statusCodeClass(log.statusCode)}>{log.statusCode}</span>
                        : '—'
                      }
                    </div>
                  </div>

                  <div className="lg:hidden flex items-center gap-3 px-4 py-3 min-h-[52px]">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${levelDotClass(log.level)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{log.action}</p>
                      <p className="text-xs font-mono text-muted-foreground mt-0.5">{log.timestamp?.replace('T', ' ').slice(0, 19)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium capitalize ${levelBadgeClass(log.level)}`}>
                        {log.level.charAt(0).toUpperCase() + log.level.slice(1)}
                      </span>
                      {log.statusCode && (
                        <span className={`text-xs font-mono ${statusCodeClass(log.statusCode)}`}>
                          {log.statusCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>Showing {filteredLogs.length} logs</div>
          <div className="flex gap-1">
            <button className="px-3 py-2 hover:bg-muted transition-colors min-h-[36px]">← Prev</button>
            <button className="px-3 py-2 bg-muted min-h-[36px]">1</button>
            <button className="px-3 py-2 hover:bg-muted transition-colors min-h-[36px]">Next →</button>
          </div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
