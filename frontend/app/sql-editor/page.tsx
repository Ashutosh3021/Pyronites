'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Play, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'

export default function SQLEditorPage() {
  const [query, setQuery] = useState(
    'SELECT * FROM users WHERE created_at > datetime("now", "-7 days")'
  )
  const [results, setResults] = useState<string[][] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [executionTime, setExecutionTime] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)

  const isDangerous = /\b(DROP|DELETE|TRUNCATE)\b/i.test(query)

  const handleRun = () => {
    if (isDangerous) { setShowConfirm(true); return }
    executeQuery()
  }

  const executeQuery = () => {
    setShowConfirm(false)
    setError(null)
    setTimeout(() => {
      setExecutionTime(145)
      setResults([
        ['id', 'email', 'created_at'],
        ['1', 'alice@example.com', '2024-01-15 10:30:00'],
        ['2', 'bob@example.com', '2024-01-16 14:22:00'],
        ['3', 'charlie@example.com', '2024-01-17 09:15:00'],
      ])
    }, 300)
  }

  const recentQueries = [
    'SELECT COUNT(*) as total FROM users',
    'SELECT * FROM posts WHERE status = "published"',
    'UPDATE sessions SET expires_at = ? WHERE id = ?',
  ]

  return (
    <PyroCoreLayout>
      {/*
        Layout:
        Desktop (lg+): editor left, recent-queries right rail (side-by-side)
        Mobile/tablet: fully vertical stack — editor → results → history
      */}
      <div className="space-y-4 lg:space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">SQL Editor</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Execute queries directly against your database
          </p>
        </div>

        {/* ── MAIN CONTENT AREA ── */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-220px)]">

          {/* ── EDITOR COLUMN ── */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

            {/* Query Editor card */}
            <div
              className="bg-card border border-border overflow-hidden flex flex-col"
              style={{ minHeight: '200px', height: 'clamp(200px, 40vh, 320px)' }}
            >
              {/* Sticky toolbar — Run button always visible */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
                <h3 className="text-sm font-semibold text-foreground">Query</h3>
                <div className="flex items-center gap-2">
                  <span className="hidden sm:block text-xs text-muted-foreground">⌘+Enter</span>
                  <button
                    onClick={handleRun}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors min-h-[36px] ${
                      isDangerous
                        ? 'bg-error/20 text-error hover:bg-error/30'
                        : 'btn-primary'
                    }`}
                  >
                    <Play className="w-4 h-4" />
                    Run
                  </button>
                </div>
              </div>

              {/* Editor body */}
              <div className="flex-1 overflow-hidden flex min-h-0">
                {/* Line numbers */}
                <div className="bg-muted/20 border-r border-border px-3 py-4 text-right text-xs font-mono text-muted-foreground select-none overflow-hidden flex-shrink-0">
                  {query.split('\n').map((_, i) => (
                    <div key={i} className="leading-6">{i + 1}</div>
                  ))}
                </div>
                {/* Textarea */}
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

            {/* Results / Error */}
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
            ) : results ? (
              <div className="bg-card border border-border overflow-hidden flex flex-col" style={{ minHeight: '160px', maxHeight: '40vh' }}>
                <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between flex-shrink-0">
                  <h3 className="text-sm font-semibold text-foreground">Results</h3>
                  <div className="text-xs text-muted-foreground">
                    {results.length - 1} rows · {executionTime}ms
                  </div>
                </div>
                {/* Horizontally scrollable results table */}
                <div className="flex-1 overflow-auto">
                  <table className="min-w-full border-collapse">
                    <thead className="bg-muted/30 border-b border-border sticky top-0">
                      <tr>
                        {results[0].map((cell, idx) => (
                          <th key={idx} className="px-4 py-2 border-r border-border text-left min-w-32 text-xs font-semibold text-foreground">
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.slice(1).map((row, rowIdx) => (
                        <tr key={rowIdx} className="border-b border-border">
                          {row.map((cell, colIdx) => (
                            <td key={colIdx} className="px-4 py-2 border-r border-border min-w-32 text-sm font-mono text-foreground">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* ── QUERY HISTORY — collapsible on mobile, inline on desktop ── */}
            {/* On mobile/tablet this sits below results in the vertical stack */}
            <div className="lg:hidden bg-card border border-border overflow-hidden">
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors min-h-[44px]"
              >
                <span>Recent Queries</span>
                {historyOpen
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                }
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
                  <div className="border-t border-border pt-3 mt-2">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 px-3">Saved Queries</p>
                    {['Get active users', 'Latest posts'].map((q) => (
                      <button key={q} className="w-full px-3 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left min-h-[44px]">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT RAIL — desktop only ── */}
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
            <div className="border-t border-border pt-4 mt-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Saved Queries</p>
              <div className="space-y-1">
                {['Get active users', 'Latest posts'].map((q) => (
                  <button key={q} className="w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left min-h-[44px] flex items-center">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CONFIRMATION MODAL ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm sm:w-full flex flex-col
            /* Mobile: full-screen slide-up sheet */
            h-full sm:h-auto
            animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 duration-200"
          >
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
