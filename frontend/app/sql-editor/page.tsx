'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Play, AlertCircle, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
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

export default function SQLEditorPage() {
  const [query, setQuery] = useState("SELECT name FROM sqlite_master WHERE type='table'")
  const [response, setResponse] = useState<ExecuteResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [executionTime, setExecutionTime] = useState(0)

  const projectName = typeof window !== 'undefined' ? getStoredProjectName() : null
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
    } catch {
      setError('Could not reach the server.')
      setResponse(null)
    } finally {
      setRunning(false)
    }
  }

  const recentQueries = [
    "SELECT name FROM sqlite_master WHERE type='table'",
    'SELECT COUNT(*) AS n FROM sqlite_master',
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
            Queries run against{projectName ? <> <span className="text-foreground font-medium">{projectName}</span></> : ' the selected project'}
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-220px)]">
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="bg-card border border-border overflow-hidden flex flex-col" style={{ minHeight: '200px', height: 'clamp(200px, 40vh, 320px)' }}>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
                <h3 className="text-sm font-semibold text-foreground">Query</h3>
                <button onClick={handleRun} disabled={running} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium min-h-[36px] ${isDangerous ? 'bg-error/20 text-error' : 'btn-primary'} disabled:opacity-70`}>
                  <Play className="w-4 h-4" />{running ? 'Running…' : 'Run'}
                </button>
              </div>
              <div className="flex-1 overflow-hidden flex min-h-0">
                <div className="bg-muted/20 border-r border-border px-3 py-4 text-right text-xs font-mono text-muted-foreground select-none overflow-hidden flex-shrink-0">
                  {query.split('\n').map((_, i) => (<div key={i} className="leading-6">{i + 1}</div>))}
                </div>
                <textarea value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleRun() }} className="flex-1 px-4 py-4 bg-transparent text-foreground font-mono text-sm resize-none focus:outline-none" spellCheck={false} />
              </div>
            </div>

            {error ? (
              <div className="bg-card border border-error border-l-4 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
                  <div><h4 className="font-semibold text-error">Query Error</h4><p className="text-sm mt-1">{error}</p></div>
                </div>
              </div>
            ) : response ? (
              <div className="space-y-3">
                {response.backup.taken && (
                  <div className="bg-success/10 border border-success/30 p-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--success)' }} />
                    <p className="text-xs" style={{ color: 'var(--success)' }}>Automatic backup taken before this query.</p>
                  </div>
                )}
                {response.results.map((result, idx) => (
                  <div key={idx} className="bg-card border border-border overflow-hidden" style={{ maxHeight: '40vh' }}>
                    <div className="px-4 py-2 border-b border-border bg-muted/30 flex justify-between">
                      <code className="text-xs font-mono text-muted-foreground truncate">{result.statement}</code>
                      <span className="text-xs text-muted-foreground">{result.kind === 'select' ? `${result.row_count} rows` : `${result.changes} changes`}</span>
                    </div>
                    {result.columns.length > 0 ? (
                      <div className="overflow-auto">
                        <table className="min-w-full border-collapse">
                          <thead className="bg-muted/30 sticky top-0"><tr>{result.columns.map((col, cidx) => (<th key={cidx} className="px-4 py-2 text-left text-xs font-semibold">{col}</th>))}</tr></thead>
                          <tbody>{result.rows.map((row, ridx) => (<tr key={ridx} className="border-b border-border">{row.map((cell, cidx) => (<td key={cidx} className="px-4 py-2 text-sm font-mono">{renderCell(cell)}</td>))}</tr>))}</tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-4 py-3 text-sm text-muted-foreground">Statement executed — {result.changes} row(s) affected.</div>
                    )}
                  </div>
                ))}
                <div className="text-xs text-muted-foreground">{totalRows} rows · {executionTime}ms</div>
              </div>
            ) : null}
          </div>

          <div className="hidden lg:flex w-72 bg-card border border-border p-4 flex-col">
            <h3 className="text-sm font-semibold mb-4">Recent Queries</h3>
            {recentQueries.map((q, idx) => (
              <button key={idx} onClick={() => setQuery(q)} className="w-full px-3 py-2 text-left hover:bg-muted text-xs font-mono text-muted-foreground truncate min-h-[44px]">{q}</button>
            ))}
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Confirm Destructive Query</h2>
            <p className="text-sm text-muted-foreground">This modifies data in the selected project. A backup will be taken first.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} className="flex-1 border border-border py-3 min-h-[44px]">Cancel</button>
              <button onClick={executeQuery} className="flex-1 bg-error text-error-foreground py-3 min-h-[44px]">Run Anyway</button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
