'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useEffect, useState } from 'react'
import { Play, AlertCircle, CheckCircle2, History, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { apiUrl, getStoredProjectName } from '@/lib/api'

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

const HISTORY_KEY = 'pyronites_sql_history'

function readHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === 'string') : []
  } catch {
    return []
  }
}

function writeHistory(entries: string[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 8)))
  } catch {
    /* history is a convenience, never a requirement */
  }
}

export default function SQLEditorPage() {
  const [query, setQuery] = useState("SELECT name FROM sqlite_master WHERE type='table'")
  const [response, setResponse] = useState<ExecuteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [executionTime, setExecutionTime] = useState(0)

  useEffect(() => {
    setHistory(readHistory())
  }, [])

  const projectName = typeof window !== 'undefined' ? getStoredProjectName() : null
  const isDangerous = /\b(DROP|DELETE|TRUNCATE)\b/i.test(query)

  const handleRun = () => {
    if (isDangerous) {
      setShowConfirm(true)
      return
    }
    executeQuery()
  }

  const executeQuery = async () => {
    setShowConfirm(false)
    setError(null)
    setRunning(true)
    const t0 = Date.now()
    try {
      const res = await fetch(apiUrl('/sql/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql: query }),
      })
      setExecutionTime(Date.now() - t0)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg =
          body?.detail?.message ??
          (typeof body?.detail === 'string' ? body.detail : null) ??
          body?.message ??
          `Query failed (${res.status}).`
        setError(msg)
        setResponse(null)
        return
      }
      const data = (await res.json()) as ExecuteResponse
      setResponse(data)
      const trimmed = query.trim()
      if (trimmed) {
        const next = [trimmed, ...readHistory().filter((q) => q !== trimmed)].slice(0, 8)
        writeHistory(next)
        setHistory(next)
      }
    } catch {
      setError('Could not reach the server.')
      setResponse(null)
    } finally {
      setRunning(false)
    }
  }

  const totalRows = response?.results.reduce((n, r) => n + r.row_count, 0) ?? 0

  const renderCell = (value: unknown) => {
    if (value === null || value === undefined)
      return <span className="text-ink-faint italic">null</span>
    if (typeof value === 'object') return <span>{JSON.stringify(value)}</span>
    return <span className="text-ink">{String(value)}</span>
  }

  const lines = query.split('\n')

  return (
    <PyroCoreLayout>
      <PageHeader
        meta="Raw access"
        title="SQL editor"
        description={
          projectName
            ? `Queries run against ${projectName}. Every project keeps its own SQLite file, so a write here cannot reach another project.`
            : 'Queries run against the selected project. Every project keeps its own SQLite file.'
        }
      />

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Editor */}
          <div className="plate overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-seam flex items-center justify-between gap-4 flex-shrink-0">
              <h2 className="text-[13px] font-semibold text-ink">Query</h2>
              <Button
                onClick={handleRun}
                disabled={running}
                variant={isDangerous ? 'destructive' : 'default'}
                size="sm"
                className="min-h-[36px]"
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                {running ? 'Running' : 'Run'}
                <span className="sr-only"> the query</span>
              </Button>
            </div>
            <div className="flex-1 overflow-hidden flex min-h-0" style={{ minHeight: '200px', height: 'clamp(200px, 38vh, 320px)' }}>
              <div
                className="bg-plate-raised/50 border-r border-seam px-3 py-4 text-right text-[11px] data text-ink-faint select-none overflow-hidden flex-shrink-0"
                aria-hidden="true"
              >
                {lines.map((_, i) => (
                  <div key={i} className="leading-6">
                    {i + 1}
                  </div>
                ))}
              </div>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleRun()
                }}
                aria-label="SQL query"
                className="flex-1 px-4 py-4 bg-transparent text-ink font-mono text-[13px] leading-6 resize-none focus:outline-none"
                spellCheck={false}
              />
            </div>
            <div className="px-4 py-2 border-t border-seam flex items-center justify-between gap-4">
              <p className="data text-[11px] text-ink-faint">Cmd or Ctrl plus Enter runs the query</p>
              {isDangerous && (
                <p className="data text-[11px] text-error">Destructive statement, confirm before running</p>
              )}
            </div>
          </div>

          {error ? (
            <div className="plate p-4" style={{ boxShadow: 'inset 2px 0 0 0 var(--error)' }}>
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-error flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h3 className="text-[13px] font-semibold text-error">Query error</h3>
                  <p className="text-[13px] mt-1 text-ink-muted break-words">{error}</p>
                </div>
              </div>
            </div>
          ) : response ? (
            <div className="space-y-4">
              {response.backup.taken && (
                <div
                  className="plate px-4 py-3 flex items-center gap-2.5"
                  style={{ boxShadow: 'inset 2px 0 0 0 var(--success)' }}
                >
                  <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" aria-hidden="true" />
                  <p className="text-[12.5px] text-ink-muted">
                    A backup was taken before this query ran.
                  </p>
                </div>
              )}

              {response.results.map((result, idx) => (
                <div key={idx} className="plate overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-seam flex justify-between gap-4 items-center">
                    <code className="data text-[11px] text-ink-muted truncate">{result.statement}</code>
                    <span className="data text-[11px] text-ink-faint flex-shrink-0">
                      {result.kind === 'select' ? `${result.row_count} rows` : `${result.changes} changes`}
                    </span>
                  </div>
                  {result.columns.length > 0 ? (
                    <div className="overflow-auto" style={{ maxHeight: '40vh' }}>
                      <table className="min-w-full border-collapse">
                        <thead className="bg-plate-raised/60 sticky top-0">
                          <tr>
                            {result.columns.map((col, cidx) => (
                              <th key={cidx} className="px-4 py-2 text-left label">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, ridx) => (
                            <tr key={ridx} className="border-b border-seam last:border-0">
                              {row.map((cell, cidx) => (
                                <td key={cidx} className="px-4 py-2 data text-[12px] text-ink-muted">
                                  {renderCell(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 py-3 text-[13px] text-ink-muted">
                      Statement executed, {result.changes} row(s) affected.
                    </div>
                  )}
                </div>
              ))}

              <div className="data text-[11px] text-ink-faint">
                {totalRows} rows returned in {executionTime}ms
              </div>
            </div>
          ) : (
            <div className="plate px-5 py-6">
              <p className="text-[13px] text-ink-muted">
                Run a statement to see its rows here. Reads are instant; writes take a backup first.
              </p>
            </div>
          )}
        </div>

        {/* History */}
        <aside className="hidden lg:flex w-72 flex-col shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="label flex items-center gap-2">
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              Recent queries
            </h2>
            {history.length > 0 && (
              <button
                onClick={() => {
                  writeHistory([])
                  setHistory([])
                }}
                className="text-ink-faint hover:text-ink transition-colors p-1 min-w-[28px] min-h-[28px] flex items-center justify-center"
                aria-label="Clear query history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="plate p-2 flex flex-col gap-1">
            {history.length === 0 ? (
              <p className="text-[12px] text-ink-faint px-2 py-3">
                Queries you run are listed here, on this device only.
              </p>
            ) : (
              history.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => setQuery(q)}
                  className="w-full px-2.5 py-2 text-left data text-[11px] text-ink-muted hover:text-ink hover:bg-plate-raised transition-colors truncate min-h-[36px]"
                >
                  {q}
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Run a destructive query?</DialogTitle>
          <DialogDescription className="mt-2">
            This statement can drop or delete rows in the selected project. A backup is taken before it
            runs, but the change cannot be undone from this screen.
          </DialogDescription>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" className="flex-1 h-10" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="flex-1 h-10" onClick={executeQuery}>
              Run anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PyroCoreLayout>
  )
}
