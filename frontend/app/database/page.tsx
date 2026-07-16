'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Edit, Trash2, Eye, EyeOff, ArrowLeft, X } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const COLUMN_TYPES = [
  'TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATETIME', 'DATE', 'JSON',
]

interface TableInfo {
  name: string
  rows: number
}

interface ColumnInfo {
  name: string
  type: string
  pk: boolean
}

interface Row {
  [key: string]: unknown
}

export default function DatabaseExplorerPage() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [schema, setSchema] = useState<ColumnInfo[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [showColumns, setShowColumns] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  const [filter, setFilter] = useState('')

  // Modals
  const [showNewTable, setShowNewTable] = useState(false)
  const [showInsert, setShowInsert] = useState(false)
  const [editRow, setEditRow] = useState<Row | null>(null)
  const [deleteRow, setDeleteRow] = useState<Row | null>(null)

  const activeTable = selectedTable ?? tables[0]?.name ?? null

  const loadTables = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const res = await fetch(`${API_BASE}/tables`, { credentials: 'include' })
      if (!res.ok) throw new Error('list')
      const data = (await res.json()) as TableInfo[]
      setTables(data)
      setSelectedTable((prev) => prev ?? data[0]?.name ?? null)
    } catch {
      setLoadErr('Could not load tables. Is the backend running on :8000?')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTable = useCallback(
    async (name: string, pageOffset = 0) => {
      if (!name) return
      setLoading(true)
      setLoadErr(null)
      try {
        const [schemaRes, rowsRes] = await Promise.all([
          fetch(`${API_BASE}/tables/${encodeURIComponent(name)}/schema`, { credentials: 'include' }),
          fetch(
            `${API_BASE}/tables/${encodeURIComponent(name)}?limit=${LIMIT}&offset=${pageOffset}`,
            { credentials: 'include' },
          ),
        ])
        if (!schemaRes.ok) throw new Error('schema')
        if (!rowsRes.ok) throw new Error('rows')
        setSchema((await schemaRes.json()) as ColumnInfo[])
        setRows((await rowsRes.json()) as Row[])
        setOffset(pageOffset)
      } catch {
        setLoadErr(`Could not load table "${name}".`)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    loadTables()
  }, [loadTables])

  useEffect(() => {
    if (activeTable) loadTable(activeTable, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTable])

  const selectTable = (name: string) => {
    setSelectedTable(name)
    setFilter('')
    loadTable(name, 0)
  }

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return rows
    const q = filter.toLowerCase()
    return rows.filter((row) =>
      Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
    )
  }, [rows, filter])

  const renderCell = (value: unknown) => {
    if (value === null || value === undefined) return <span className="text-muted-foreground italic">null</span>
    if (typeof value === 'object') return <span>{JSON.stringify(value)}</span>
    return <span className="text-foreground">{String(value)}</span>
  }

  // ── New Table submit ───────────────────────────────────────────────────────
  const handleCreateTable = async (name: string, cols: { name: string; type: string }[]) => {
    const res = await fetch(`${API_BASE}/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ table: name, columns: cols }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? 'Failed to create table.')
    }
  }

  // ── Insert Row submit ───────────────────────────────────────────────────────
  const handleInsertRow = async (tableName: string, row: Row) => {
    const res = await fetch(`${API_BASE}/tables/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? 'Failed to insert row.')
    }
  }

  // ── Edit Row submit ──────────────────────────────────────────────────────────
  const handleEditRow = async (tableName: string, idVal: string, row: Row) => {
    const res = await fetch(`${API_BASE}/tables/${encodeURIComponent(tableName)}/${encodeURIComponent(idVal)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? 'Failed to update row.')
    }
  }

  // ── Delete Row submit ───────────────────────────────────────────────────────
  const handleDeleteRow = async (tableName: string, idVal: string) => {
    const res = await fetch(`${API_BASE}/tables/${encodeURIComponent(tableName)}/${encodeURIComponent(idVal)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? 'Failed to delete row.')
    }
  }

  const showingTableOnMobile = selectedTable !== null

  return (
    <PyroCoreLayout>
      <div className="h-full flex gap-6">
        {/* ── TABLE LIST RAIL ─────────────────────────────────────── */}
        <div
          className={[
            'bg-card border border-border rounded-lg p-4 flex flex-col',
            'lg:w-64 lg:flex-shrink-0',
            showingTableOnMobile ? 'hidden lg:flex' : 'flex w-full lg:w-64',
          ].join(' ')}
        >
          <div className="mb-4">
            <button
              onClick={() => setShowNewTable(true)}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Table
            </button>
          </div>
          <div className="space-y-1 flex-1 overflow-auto">
            {tables.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground px-1">No tables yet.</p>
            )}
            {tables.map((table) => (
              <button
                key={table.name}
                onClick={() => selectTable(table.name)}
                className={[
                  'w-full px-3 py-3 text-sm text-left transition-colors',
                  'min-h-[44px]',
                  activeTable === table.name
                    ? 'bg-muted text-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                ].join(' ')}
              >
                <div className="font-medium">{table.name}</div>
                <div className="text-xs text-muted-foreground">{table.rows} rows</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── DATA GRID AREA ─────────────────────────────────────── */}
        <div
          className={[
            'flex-1 flex flex-col gap-4 min-w-0',
            !showingTableOnMobile ? 'hidden lg:flex' : 'flex',
          ].join(' ')}
        >
          {loadErr && (
            <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
              {loadErr}
            </p>
          )}

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3 lg:mb-0">
              <button
                onClick={() => setSelectedTable(null)}
                className="lg:hidden p-2 -ml-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Back to table list"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <h2 className="text-base lg:text-lg font-semibold text-foreground truncate">
                  Table: <span className="text-accent">{activeTable ?? '—'}</span>
                </h2>
                <span className="text-sm text-muted-foreground flex-shrink-0">
                  {rows.length} rows
                </span>
              </div>
              <div className="hidden lg:flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Filter..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => setShowColumns(!showColumns)}
                  className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="Toggle columns"
                >
                  {showColumns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={() => setShowInsert(true)} className="btn-primary">Insert Row</button>
              </div>
            </div>
            <div className="flex items-center gap-2 lg:hidden mt-3">
              <input
                type="text"
                placeholder="Filter..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => setShowColumns(!showColumns)}
                className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center border border-border"
                title="Toggle columns"
              >
                {showColumns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <button onClick={() => setShowInsert(true)} className="btn-primary flex-shrink-0">Insert</button>
            </div>
          </div>

          <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto relative">
              {!activeTable ? (
                <div className="p-12 text-center text-muted-foreground">
                  Select or create a table to view its rows.
                </div>
              ) : (
                <table className="min-w-full border-collapse">
                  <thead className="bg-muted/30 border-b border-border sticky top-0 z-20">
                    <tr>
                      <th className="w-12 px-4 py-3 border-r border-border text-xs font-semibold text-muted-foreground text-center bg-muted/30 sticky left-0 z-30">
                        #
                      </th>
                      {showColumns &&
                        schema.map((col) => (
                          <th key={col.name} className="px-4 py-3 border-r border-border text-left min-w-40">
                            <div className="text-xs font-semibold text-foreground">{col.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-muted-foreground font-mono">{col.type}</span>
                              {col.pk && (
                                <span
                                  className="inline-block px-1.5 py-0.5 text-xs font-semibold"
                                  style={{ backgroundColor: 'rgba(255,106,0,0.15)', color: 'var(--pyro-orange)' }}
                                >
                                  PK
                                </span>
                              )}
                            </div>
                          </th>
                        ))}
                      <th className="w-24 px-4 py-3 text-xs font-semibold text-muted-foreground" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-border hover:bg-muted/20 transition-colors group">
                        <td className="w-12 px-4 py-3 border-r border-border text-xs text-muted-foreground text-center bg-card sticky left-0 group-hover:bg-muted/20 transition-colors">
                          {idx + 1}
                        </td>
                        {showColumns &&
                          schema.map((col) => (
                            <td key={col.name} className="px-4 py-3 border-r border-border min-w-40 text-sm font-mono">
                              {renderCell(row[col.name])}
                            </td>
                          ))}
                        <td className="w-24 px-4 py-3">
                          <div className="flex items-center justify-center gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditRow(row)}
                              className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                              aria-label="Edit row"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteRow(row)}
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
              )}
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground flex-shrink-0">
              <div>
                Showing {filteredRows.length} of {rows.length} loaded rows
                {tables.find((t) => t.name === activeTable) && (
                  <> · {tables.find((t) => t.name === activeTable)!.rows} total</>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  disabled={offset <= 0}
                  onClick={() => activeTable && loadTable(activeTable, Math.max(0, offset - LIMIT))}
                  className="px-3 py-2 hover:bg-muted transition-colors min-h-[36px] disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  disabled={rows.length < LIMIT}
                  onClick={() => activeTable && loadTable(activeTable, offset + LIMIT)}
                  className="px-3 py-2 hover:bg-muted transition-colors min-h-[36px] disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── NEW TABLE MODAL ── */}
      {showNewTable && (
        <NewTableModal
          apiBase={API_BASE}
          onClose={() => setShowNewTable(false)}
          onCreate={handleCreateTable}
          onDone={(name) => {
            setShowNewTable(false)
            loadTables().then(() => selectTable(name))
          }}
        />
      )}

      {/* ── INSERT ROW MODAL ── */}
      {showInsert && activeTable && (
        <RowModal
          title="Insert Row"
          tableName={activeTable}
          schema={schema}
          initial={{}}
          apiBase={API_BASE}
          onClose={() => setShowInsert(false)}
          onSubmit={handleInsertRow}
          onDone={() => {
            setShowInsert(false)
            loadTable(activeTable, offset)
          }}
        />
      )}

      {/* ── EDIT ROW MODAL ── */}
      {editRow && activeTable && (
        <RowModal
          title="Edit Row"
          tableName={activeTable}
          schema={schema}
          initial={editRow}
          apiBase={API_BASE}
          onClose={() => setEditRow(null)}
          onSubmit={handleEditRow}
          onDone={() => {
            setEditRow(null)
            loadTable(activeTable, offset)
          }}
        />
      )}

      {/* ── DELETE CONFIRM MODAL ── */}
      {deleteRow && activeTable && (
        <DeleteModal
          apiBase={API_BASE}
          tableName={activeTable}
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDelete={handleDeleteRow}
          onDone={() => {
            setDeleteRow(null)
            loadTable(activeTable, offset)
          }}
        />
      )}
    </PyroCoreLayout>
  )
}

// ─── New Table Modal ─────────────────────────────────────────────────────────
function NewTableModal({
  apiBase,
  onClose,
  onCreate,
  onDone,
}: {
  apiBase: string
  onClose: () => void
  onCreate: (name: string, cols: { name: string; type: string }[]) => Promise<void>
  onDone: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [cols, setCols] = useState<{ name: string; type: string }[]>([
    { name: 'id', type: 'INTEGER' },
    { name: 'created_at', type: 'DATETIME' },
  ])
  const [pk, setPk] = useState('id')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const addCol = () => setCols((c) => [...c, { name: '', type: 'TEXT' }])
  const updateCol = (i: number, patch: Partial<{ name: string; type: string }>) =>
    setCols((c) => c.map((col, idx) => (idx === i ? { ...col, ...patch } : col)))
  const removeCol = (i: number) => {
    setCols((c) => c.filter((_, idx) => idx !== i))
    setPk((p) => (p === cols[i]?.name ? '' : p))
  }

  const submit = async () => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setErr('Table name must be alphanumeric (letters, digits, underscores).')
      return
    }
    const valid = cols.every((c) => c.name.trim() && COLUMN_TYPES.includes(c.type))
    if (!valid) {
      setErr('Every column needs a name and a valid type.')
      return
    }
    if (!cols.some((c) => c.name === pk)) setPk('')
    setSaving(true)
    setErr(null)
    try {
      await onCreate(name, cols)
      onDone(name)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create table.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="New Table" onClose={onClose}>
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {err && <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{err}</p>}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Table name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_table"
            className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground font-mono placeholder-muted-foreground focus:outline-none focus:border-accent min-h-[44px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Columns</label>
          <div className="space-y-2">
            {cols.map((col, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={col.name}
                  onChange={(e) => updateCol(i, { name: e.target.value })}
                  placeholder="column"
                  className="flex-1 px-3 py-2 bg-background border border-border text-sm text-foreground font-mono focus:outline-none focus:border-accent min-h-[40px]"
                />
                <select
                  value={col.type}
                  onChange={(e) => updateCol(i, { type: e.target.value })}
                  className="px-2 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[40px]"
                >
                  {COLUMN_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeCol(i)}
                  className="p-2 text-muted-foreground hover:text-error transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
                  aria-label="Remove column"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={addCol}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              + Add column
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Primary key</label>
          <select
            value={pk}
            onChange={(e) => setPk(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]"
          >
            <option value="">(none)</option>
            {cols.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-3 p-6 border-t border-border flex-shrink-0">
        <button onClick={onClose} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 btn-primary min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {saving ? 'Creating…' : 'Create Table'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Row Modal (insert / edit) ──────────────────────────────────────────────
function RowModal({
  title,
  tableName,
  schema,
  initial,
  apiBase,
  onClose,
  onSubmit,
  onDone,
}: {
  title: string
  tableName: string
  schema: ColumnInfo[]
  initial: Row
  apiBase: string
  onClose: () => void
  onSubmit: (t: string, id: string, row: Row) => Promise<void>
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const col of schema) {
      const v = initial[col.name]
      init[col.name] = v === null || v === undefined ? '' : String(v)
    }
    return init
  })
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const row: Row = {}
    for (const col of schema) {
      const raw = values[col.name]
      if (raw === '' && col.name === 'id') continue // let the backend mint the id
      if (raw === '') continue
      // Best-effort type coercion for numeric/bool columns.
      if (col.type === 'INTEGER') row[col.name] = Number(raw)
      else if (col.type === 'REAL' || col.type === 'NUMERIC') row[col.name] = Number(raw)
      else if (col.type === 'BOOLEAN') row[col.name] = raw === 'true' || raw === '1'
      else row[col.name] = raw
    }
    setSaving(true)
    setErr(null)
    try {
      if (title === 'Edit Row') {
        const idVal = String(initial['id'] ?? '')
        await onSubmit(tableName, idVal, row)
      } else {
        await onSubmit(tableName, '', row)
      }
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save row.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="flex-1 p-6 space-y-3 overflow-y-auto">
        {err && <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{err}</p>}
        {schema.length === 0 && (
          <p className="text-sm text-muted-foreground">No columns to edit.</p>
        )}
        {schema.map((col) => (
          <div key={col.name} className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground">
              {col.name}
              <span className="ml-1 text-muted-foreground font-mono normal-case">{col.type}{col.pk ? ' · PK' : ''}</span>
            </label>
            <input
              value={values[col.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
              placeholder={col.name === 'id' ? '(auto)' : ''}
              className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground font-mono focus:outline-none focus:border-accent min-h-[44px]"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3 p-6 border-t border-border flex-shrink-0">
        <button onClick={onClose} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 btn-primary min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteModal({
  apiBase,
  tableName,
  row,
  onClose,
  onDelete,
  onDone,
}: {
  apiBase: string
  tableName: string
  row: Row
  onClose: () => void
  onDelete: (t: string, id: string) => Promise<void>
  onDone: () => void
}) {
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const idVal = row['id'] != null ? String(row['id']) : null

  const submit = async () => {
    if (idVal === null) {
      setErr('Cannot delete a row without an id column.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onDelete(tableName, idVal)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete row.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Delete Row" onClose={onClose}>
      <div className="flex-1 p-6 space-y-3">
        {err && <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{err}</p>}
        <p className="text-sm text-muted-foreground">
          Delete row <span className="font-mono text-foreground">id={idVal ?? '(none)'}</span> from{' '}
          <span className="font-mono text-foreground">{tableName}</span>? This cannot be undone.
        </p>
      </div>
      <div className="flex gap-3 p-6 border-t border-border flex-shrink-0">
        <button onClick={onClose} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px] disabled:opacity-70 flex items-center justify-center gap-2"
        >
          {saving ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Shared modal shell ───────────────────────────────────────────────────────
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-card border border-border w-full sm:max-w-lg flex flex-col max-h-full overflow-y-auto">
        <div className="flex items-center justify-between p-6 pb-0 flex-shrink-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
