'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Plus, Edit, Trash2, Eye, EyeOff, ArrowLeft } from 'lucide-react'

const tables = [
  { name: 'users', rows: 127 },
  { name: 'posts', rows: 892 },
  { name: 'comments', rows: 3421 },
  { name: 'sessions', rows: 45 },
]

const columns = [
  { name: 'id', type: 'INTEGER', pk: true },
  { name: 'email', type: 'TEXT', pk: false },
  { name: 'created_at', type: 'TIMESTAMP', pk: false },
  { name: 'status', type: 'TEXT', pk: false },
]

const tableData = [
  ['1', 'alice@example.com', '2024-01-15', 'active'],
  ['2', 'bob@example.com', '2024-01-16', 'active'],
  ['3', 'charlie@example.com', '2024-01-17', 'inactive'],
]

export default function DatabaseExplorerPage() {
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [showColumns, setShowColumns] = useState(true)

  // On mobile, track whether we're in "list view" or "table view"
  // selectedTable === null means show the table list on mobile
  const showingTableOnMobile = selectedTable !== null

  // The active table for desktop is always the first table by default
  const activeTable = selectedTable ?? tables[0].name

  return (
    <PyroCoreLayout>
      {/*
        Layout strategy:
        - Desktop (lg+): side-by-side — table list rail + data grid
        - Mobile/tablet (<lg): single-panel, either table list OR data grid
      */}
      <div className="h-full flex gap-6">

        {/* ── TABLE LIST RAIL ────────────────────────────────────────────── */}
        {/*
          Desktop: always visible, 256px fixed width
          Mobile: full-width panel, hidden when a table is selected
        */}
        <div
          className={[
            'bg-card border border-border rounded-lg p-4 flex flex-col',
            // Desktop: fixed width sidebar
            'lg:w-64 lg:flex-shrink-0',
            // Mobile: full width, hidden when viewing table data
            showingTableOnMobile ? 'hidden lg:flex' : 'flex w-full lg:w-64',
          ].join(' ')}
        >
          <div className="mb-4">
            <button className="w-full btn-primary flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" />
              New Table
            </button>
          </div>

          <div className="space-y-1 flex-1">
            {tables.map((table) => (
              <button
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                className={[
                  'w-full px-3 py-3 text-sm text-left transition-colors',
                  // Min touch target
                  'min-h-[44px]',
                  activeTable === table.name
                    ? 'bg-muted text-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                ].join(' ')}
              >
                <div className="font-medium">{table.name}</div>
                <div className="text-xs text-muted-foreground">
                  {table.rows} rows
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── DATA GRID AREA ─────────────────────────────────────────────── */}
        {/*
          Desktop: always visible, fills remaining space
          Mobile: full-width, only shown when a table is selected
        */}
        <div
          className={[
            'flex-1 flex flex-col gap-4 min-w-0',
            !showingTableOnMobile ? 'hidden lg:flex' : 'flex',
          ].join(' ')}
        >
          {/* ── TOOLBAR ── */}
          <div className="bg-card border border-border rounded-lg p-4">
            {/* Row 1: back button (mobile) + table name + row count */}
            <div className="flex items-center gap-3 mb-3 lg:mb-0">
              {/* Back arrow — mobile only */}
              <button
                onClick={() => setSelectedTable(null)}
                className="lg:hidden p-2 -ml-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Back to table list"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 flex-1 min-w-0">
                <h2 className="text-base lg:text-lg font-semibold text-foreground truncate">
                  Table:{' '}
                  <span className="text-accent">{activeTable}</span>
                </h2>
                <span className="text-sm text-muted-foreground flex-shrink-0">
                  127 rows
                </span>
              </div>

              {/* Desktop: inline controls */}
              <div className="hidden lg:flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Filter..."
                  className="px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => setShowColumns(!showColumns)}
                  className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="Toggle columns"
                >
                  {showColumns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button className="btn-primary">Insert Row</button>
              </div>
            </div>

            {/* Row 2: controls on mobile/tablet — always below title row */}
            <div className="flex items-center gap-2 lg:hidden">
              <input
                type="text"
                placeholder="Filter..."
                className="flex-1 px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => setShowColumns(!showColumns)}
                className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center border border-border"
                title="Toggle columns"
              >
                {showColumns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <button className="btn-primary flex-shrink-0">Insert Row</button>
            </div>
          </div>

          {/* ── DATA TABLE ── */}
          <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
            {/*
              Horizontal scroll ONLY inside the grid container.
              First column (row number) is sticky on the left.
            */}
            <div className="flex-1 overflow-auto relative">
              {/* Scroll-shadow on right edge — indicates more columns */}
              <div
                className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 z-10"
                style={{
                  background:
                    'linear-gradient(to left, var(--card) 0%, transparent 100%)',
                }}
              />

              <table className="min-w-full border-collapse">
                {/* Column headers */}
                <thead className="bg-muted/30 border-b border-border sticky top-0 z-20">
                  <tr>
                    {/* Row number — sticky left */}
                    <th
                      className="w-12 px-4 py-3 border-r border-border text-xs font-semibold text-muted-foreground text-center bg-muted/30 sticky left-0 z-30"
                    >
                      #
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.name}
                        className="px-4 py-3 border-r border-border text-left min-w-40"
                      >
                        <div className="text-xs font-semibold text-foreground">
                          {col.name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground font-mono">
                            {col.type}
                          </span>
                          {col.pk && (
                            <span
                              className="inline-block px-1.5 py-0.5 text-xs font-semibold"
                              style={{
                                backgroundColor: 'rgba(255,106,0,0.15)',
                                color: 'var(--pyro-orange)',
                              }}
                            >
                              PK
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                    {/* Actions column */}
                    <th className="w-24 px-4 py-3 text-xs font-semibold text-muted-foreground" />
                  </tr>
                </thead>

                <tbody>
                  {tableData.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-border hover:bg-muted/20 transition-colors group"
                    >
                      {/* Row number — sticky left */}
                      <td className="w-12 px-4 py-3 border-r border-border text-xs text-muted-foreground text-center bg-card sticky left-0 group-hover:bg-muted/20 transition-colors">
                        {idx + 1}
                      </td>

                      {row.map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          className="px-4 py-3 border-r border-border min-w-40 text-sm font-mono"
                        >
                          {cellIdx === 3 ? (
                            <span
                              className={`inline-block px-2 py-0.5 text-xs font-medium ${
                                cell === 'active'
                                  ? 'bg-success/15 text-success'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {cell}
                            </span>
                          ) : (
                            <span className="text-foreground">{cell}</span>
                          )}
                        </td>
                      ))}

                      {/* Row actions:
                          Desktop: hover-revealed
                          Mobile/touch: always visible (no hover state on touch) */}
                      <td className="w-24 px-4 py-3">
                        <div className="flex items-center justify-center gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                          <button
                            className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                            aria-label="Edit row"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            className="p-2 hover:bg-error/10 text-muted-foreground hover:text-error transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                            aria-label="Delete row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground flex-shrink-0">
              <div>
                Showing 1–{Math.min(10, tableData.length)} of{' '}
                {tableData.length} rows
              </div>
              <div className="flex gap-1">
                <button className="px-3 py-2 hover:bg-muted transition-colors min-h-[36px]">
                  ← Prev
                </button>
                <button className="px-3 py-2 bg-muted min-h-[36px]">1</button>
                <button className="px-3 py-2 hover:bg-muted transition-colors min-h-[36px]">
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
