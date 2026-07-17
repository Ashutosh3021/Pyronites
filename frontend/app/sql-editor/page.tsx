'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Play, AlertCircle, ChevronDown, ChevronUp, CheckCircle2, Server } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface StatementResult {
  statement: string
  kind: 'select' | 'write'
  columns: string[]
  rows: unknown[][]
  row_count: number
  changes: number
}

interface ExecuteResponse {
  results: StatementResult[]
  backup: { taken: boolean; path?: string }
}

export default function SQLEditorPage() {
  const [query, setQuery] = useState('SELECT * FROM users')
  const [response, setResponse] = useState<ExecuteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [executionTime, setExecutionTime] = useState(0)

  const isDangerous = /\b(DROP|DELETE|TRUNCATE)\b/i.test(query)

  const handleRun = () => {
    if (isDangerous) { setShowConfirm(true); return }
    executeQuery()
  }

  const executeQuery = async () => {
    setShowConfirm(false)
    setError(null)
    setRunning(true)
    const t0 = Date.now()
    try {
      const res = await fetch(`${API_BASE}/sql/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql: query }),
      })
      setExecutionTime(Date.now() - t0)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.message ?? `Query failed (${res.status}).`)
        setResponse(null)
        return
      }
      const data = (await res.json()) as ExecuteResponse
      setResponse(data)
    } catch {
      setError('Could not reach the server. Is the backend running on :8000?')
      setResponse(null)
    } finally {
      setRunning(false)
    }
  }

  const recentQueries = [
    'SELECT COUNT(*) as total FROM users',
    'SELECT * FROM posts WHERE status = "published"',
    'UPDATE sessions SET expires_at = ? WHERE id = ?',
  ]

  const totalRows = response?.results.reduce((n, r) => n + r.row_count, 0) ?? 0

  const renderCell = (value: unknown) => {
    if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>
    if (typeof value === 'object') return <span>{JSON.stringify(value)}</span>
    return <span className="text-foreground">{String(value)}</span>
  }

  return (
    <PyroCoreLayout>
      <div className="space-y-4 lg:space-y-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">SQL Editor</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Execute queries directly against your database
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-220px)]">
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div
              className="bg-card border border-border overflow-hidden flex flex-col"
              style={{ minHeight: '200px', height: 'clamp(200px, 40vh, 320px)' }}
            >
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
                <h3 className="text-sm font-semibold text-foreground">Query</h3>
                <div className="flex items-center gap-2">
                  <span className="hidden sm:block text-xs text-muted-foreground">⌘+Enter</span>
                  <button
                    onClick={handleRun}
                    disabled={running}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors min-h-[36px] ${
                      isDangerous
                        ? 'bg-error/20 text-error hover:bg-error/30'
                        : 'btn-primary'
                    } disabled:opacity-70`}
                  >
                    <Play className="w-4 h-4" />
                    {running ? 'Running…' : 'Run'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden flex min-h-0">
                <div className="bg-muted/20 border-r border-border px-3 py-4 text-right text-xs font-mono text-muted-foreground select-none overflow-hidden flex-shrink-0">
                  {query.split('\n').map((_, i) => (
                    <div key={i} className="leading-6">{i + 1}</div>
                  ))}
                </div>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleRun()
                  }}
                  className="flex-1 px-4 py-4 bg-transparent text-foreground font-mono text-sm resize-none focus:outline-none placeholder-muted-foreground"
                  spellCheck="false"
                />
              </div>
            </div>

            {error ? (
              <div className="bg-card border border-error border-l-4 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-error">Query Error</h4>
                    <p className="text-sm text-foreground mt-1">{error}</p>
                  </div>
                </div>
              </div>
            ) : response ? (
              <div className="space-y-3">
                {response.backup.taken && (
                  <div className="bg-success/10 border border-success/30 p-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
                    <p className="text-xs" style={{ color: 'var(--success)' }}>
                      Automatic backup taken before this query.
                      {response.backup.path ? ` (${response.backup.path})` : ''}
                    </p>
                  </div>
                )}
                {response.results.map((result, idx) => (
                  <div key={idx} className="bg-card border border-border overflow-hidden flex flex-col" style={{ minHeight: '120px', maxHeight: '40vh' }}>
                    <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between flex-shrink-0">
                      <code className="text-xs font-mono text-muted-foreground truncate">{result.statement}</code>
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                        {result.kind === 'select'
                          ? `${result.row_count} rows`
                          : `${result.changes} changes`}
                      </span>
                    </div>
                    {result.columns.length > 0 ? (
                      <div className="flex-1 overflow-auto">
                        <table className="min-w-full border-collapse">
                          <thead className="bg-muted/30 border-b border-border sticky top-0">
                            <tr>
                              {result.columns.map((col, cidx) => (
                                <th key={cidx} className="px-4 py-2 border-r border-border text-left min-w-32 text-xs font-semibold text-foreground">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {result.rows.map((row, ridx) => (
                              <tr key={ridx} className="border-b border-border">
                                {row.map((cell, cidx) => (
                                  <td key={cidx} className="px-4 py-2 border-r border-border min-w-32 text-sm font-mono">
                                    {renderCell(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center px-4 text-sm text-muted-foreground">
                        Statement executed — {result.changes} row(s) affected.
                      </div>
                    )}
                  </div>
                ))}
                <div className="text-xs text-muted-foreground">
                  {totalRows} rows · {executionTime}ms
                </div>
              </div>
            ) : null}

            <div className="lg:hidden bg-card border border-border overflow-hidden">
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors min-h-[44px]"
              >
                <span>Recent Queries</span>
                {historyOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {historyOpen && (
                <div className="border-t border-border px-3 py-3 space-y-1">
                  {recentQueries.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setQuery(q); setHistoryOpen(false) }}
                      className="w-full px-3 py-3 text-left hover:bg-muted transition-colors min-h-[44px]"
                    >
                      <p className="text-xs font-mono text-muted-foreground truncate">{q}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="hidden lg:flex w-72 bg-card border border-border p-4 flex-col flex-shrink-0">
            <h3 className="text-sm font-semibold text-foreground mb-4">Recent Queries</h3>
            <div className="space-y-1 flex-1">
              {recentQueries.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => setQuery(q)}
                  className="w-full px-3 py-2 text-left hover:bg-muted transition-colors group min-h-[44px] flex items-center"
                >
                  <p className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors truncate">
                    {q}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm sm:w-full flex flex-col h-full sm:h-auto">
            <div className="flex items-center justify-between p-6 border-b border-border sm:border-b-0 sm:pb-0">
              <h2 className="text-lg font-semibold text-foreground">Confirm Destructive Query</h2>
            </div>
            <div className="flex-1 p-6 sm:pt-4">
              <p className="text-sm text-muted-foreground mb-4">
                This will permanently modify data. A backup will be taken automatically before this runs.
              </p>
            </div>
            <div className="flex gap-3 p-6 pt-0 sm:pt-0">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={executeQuery}
                className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px]"
              >
                Run Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
