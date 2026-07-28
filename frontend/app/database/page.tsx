'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Edit, Trash2, Eye, EyeOff, ArrowLeft, X } from 'lucide-react'
import {
  apiUrl,
  getStoredProjectName,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'

const COLUMN_TYPES = [
  'TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATETIME', 'DATE', 'JSON',
]

interface TableInfo { name: string; rows: number }
interface ColumnInfo { name: string; type: string; pk: boolean }
interface Row { [key: string]: unknown }

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
  const [showNewTable, setShowNewTable] = useState(false)
  const [showInsert, setShowInsert] = useState(false)
  const [editRow, setEditRow] = useState<Row | null>(null)
  const [deleteRow, setDeleteRow] = useState<Row | null>(null)
  const [projectLabel, setProjectLabel] = useState<string | null>(null)

  const activeTable = selectedTable ?? tables[0]?.name ?? null

  const loadTables = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    setProjectLabel(getStoredProjectName())
    try {
      const res = await fetch(apiUrl('/tables'), { credentials: 'include' })
      if (!res.ok) throw new Error('list')
      const data = (await res.json()) as TableInfo[]
      setTables(data)
      setSelectedTable((prev) => {
        if (prev && data.some((t) => t.name === prev)) return prev
        return data[0]?.name ?? null
      })
    } catch {
      setLoadErr('Could not load tables for this project.')
      setTables([])
      setSelectedTable(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTable = useCallback(async (name: string, pageOffset = 0) => {
    if (!name) return
    setLoading(true)
    setLoadErr(null)
    try {
      const [schemaRes, rowsRes] = await Promise.all([
        fetch(apiUrl(`/tables/${encodeURIComponent(name)}/schema`), { credentials: 'include' }),
        fetch(apiUrl(`/tables/${encodeURIComponent(name)}?limit=${LIMIT}&offset=${pageOffset}`), {
          credentials: 'include',
        }),
      ])
      if (!schemaRes.ok || !rowsRes.ok) throw new Error('load')
      setSchema((await schemaRes.json()) as ColumnInfo[])
      setRows((await rowsRes.json()) as Row[])
      setOffset(pageOffset)
    } catch {
      setLoadErr(`Could not load table "${name}".`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTables()
    const onChange = () => {
      setSelectedTable(null)
      setSchema([])
      setRows([])
      loadTables()
    }
    window.addEventListener(PROJECT_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, onChange)
  }, [loadTables])

  useEffect(() => {
    if (activeTable) loadTable(activeTable, 0)
  }, [activeTable, loadTable])

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
    if (value === null || value === undefined)
      return <span className="text-muted-foreground italic">null</span>
    if (typeof value === 'object') return <span>{JSON.stringify(value)}</span>
    return <span className="text-foreground">{String(value)}</span>
  }

  const handleCreateTable = async (name: string, cols: { name: string; type: string }[]) => {
    const res = await fetch(apiUrl('/tables'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ table: name, columns: cols }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? body?.detail?.message ?? 'Failed to create table.')
    }
  }

  const handleInsertRow = async (tableName: string, row: Row) => {
    const res = await fetch(apiUrl(`/tables/${encodeURIComponent(tableName)}`), {
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

  const handleEditRow = async (tableName: string, idVal: string, row: Row) => {
    const res = await fetch(
      apiUrl(`/tables/${encodeURIComponent(tableName)}/${encodeURIComponent(idVal)}`),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(row),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? 'Failed to update row.')
    }
  }

  const handleDeleteRow = async (tableName: string, idVal: string) => {
    const res = await fetch(
      apiUrl(`/tables/${encodeURIComponent(tableName)}/${encodeURIComponent(idVal)}`),
      { method: 'DELETE', credentials: 'include' },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? 'Failed to delete row.')
    }
  }

  const showingTableOnMobile = selectedTable !== null

  return (
    <PyroCoreLayout>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-foreground">Database</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tables for{' '}
          <span className="text-foreground font-medium">{projectLabel ?? 'selected project'}</span>
          {' '}only — switch projects in the sidebar.
        </p>
      </div>

      <div className="h-full flex gap-6">
        <div className={['bg-card border border-border rounded-lg p-4 flex flex-col', 'lg:w-64 lg:flex-shrink-0', showingTableOnMobile ? 'hidden lg:flex' : 'flex w-full lg:w-64'].join(' ')}>
          <div className="mb-4">
            <button onClick={() => setShowNewTable(true)} className="w-full btn-primary flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> New Table
            </button>
          </div>
          <div className="space-y-1 flex-1 overflow-auto">
            {tables.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground px-1">No tables in this project yet.</p>
            )}
            {tables.map((table) => (
              <button key={table.name} onClick={() => selectTable(table.name)} className={['w-full px-3 py-3 text-sm text-left min-h-[44px]', activeTable === table.name ? 'bg-muted text-accent' : 'text-muted-foreground hover:bg-muted/50'].join(' ')}>
                <div className="font-medium">{table.name}</div>
                <div className="text-xs text-muted-foreground">{table.rows} rows</div>
              </button>
            ))}
          </div>
        </div>

        <div className={['flex-1 flex flex-col gap-4 min-w-0', !showingTableOnMobile ? 'hidden lg:flex' : 'flex'].join(' ')}>
          {loadErr && <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>}

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedTable(null)} className="lg:hidden p-2 min-w-[44px] min-h-[44px]" aria-label="Back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-base font-semibold truncate">Table: <span className="text-accent">{activeTable ?? '—'}</span></h2>
              <span className="text-sm text-muted-foreground">{rows.length} rows</span>
              <div className="ml-auto hidden lg:flex items-center gap-2">
                <input type="text" placeholder="Filter..." value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 border border-border text-sm bg-background min-h-[36px]" />
                <button onClick={() => setShowColumns(!showColumns)} className="p-2 min-w-[44px] min-h-[44px]">{showColumns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                <button onClick={() => setShowInsert(true)} className="btn-primary" disabled={!activeTable}>Insert Row</button>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-card border border-border rounded-lg overflow-auto">
            {!activeTable ? (
              <div className="p-12 text-center text-muted-foreground">Select or create a table.</div>
            ) : (
              <table className="min-w-full border-collapse">
                <thead className="bg-muted/30 border-b border-border sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-xs text-muted-foreground">#</th>
                    {showColumns && schema.map((col) => (
                      <th key={col.name} className="px-4 py-3 text-left text-xs">
                        <div className="font-semibold">{col.name}</div>
                        <div className="font-mono text-muted-foreground">{col.type}{col.pk ? ' · PK' : ''}</div>
                      </th>
                    ))}
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border hover:bg-muted/20 group">
                      <td className="px-4 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                      {showColumns && schema.map((col) => (
                        <td key={col.name} className="px-4 py-3 text-sm font-mono">{renderCell(row[col.name])}</td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                          <button onClick={() => setEditRow(row)} className="p-2 min-w-[44px] min-h-[44px]" aria-label="Edit"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteRow(row)} className="p-2 min-w-[44px] min-h-[44px] text-error" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {activeTable && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Showing {filteredRows.length} loaded</span>
              <div className="flex gap-1">
                <button disabled={offset <= 0} onClick={() => loadTable(activeTable, Math.max(0, offset - LIMIT))} className="px-3 py-2 min-h-[36px] disabled:opacity-40">← Prev</button>
                <button disabled={rows.length < LIMIT} onClick={() => loadTable(activeTable, offset + LIMIT)} className="px-3 py-2 min-h-[36px] disabled:opacity-40">Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showNewTable && (
        <NewTableModal onClose={() => setShowNewTable(false)} onCreate={handleCreateTable} onDone={(name) => { setShowNewTable(false); loadTables().then(() => selectTable(name)) }} />
      )}
      {showInsert && activeTable && (
        <RowModal title="Insert Row" tableName={activeTable} schema={schema} initial={{}} onClose={() => setShowInsert(false)} onSubmit={async (t, _id, row) => handleInsertRow(t, row)} onDone={() => { setShowInsert(false); loadTable(activeTable, offset) }} />
      )}
      {editRow && activeTable && (
        <RowModal title="Edit Row" tableName={activeTable} schema={schema} initial={editRow} onClose={() => setEditRow(null)} onSubmit={handleEditRow} onDone={() => { setEditRow(null); loadTable(activeTable, offset) }} />
      )}
      {deleteRow && activeTable && (
        <DeleteModal tableName={activeTable} row={deleteRow} onClose={() => setDeleteRow(null)} onDelete={handleDeleteRow} onDone={() => { setDeleteRow(null); loadTable(activeTable, offset) }} />
      )}
    </PyroCoreLayout>
  )
}

function NewTableModal({ onClose, onCreate, onDone }: { onClose: () => void; onCreate: (name: string, cols: { name: string; type: string }[]) => Promise<void>; onDone: (name: string) => void }) {
  const [name, setName] = useState('')
  const [cols, setCols] = useState<{ name: string; type: string }[]>([{ name: 'id', type: 'INTEGER' }, { name: 'created_at', type: 'DATETIME' }])
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { setErr('Invalid table name.'); return }
    setSaving(true); setErr(null)
    try { await onCreate(name, cols); onDone(name) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title="New Table" onClose={onClose}>
      <div className="p-6 space-y-4">
        {err && <p className="text-sm" style={{ color: 'var(--error)' }}>{err}</p>}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="table_name" className="w-full px-3 py-2 border border-border bg-background font-mono min-h-[44px]" />
        {cols.map((col, i) => (
          <div key={i} className="flex gap-2">
            <input value={col.name} onChange={(e) => setCols((c) => c.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="flex-1 px-3 py-2 border border-border bg-background font-mono" />
            <select value={col.type} onChange={(e) => setCols((c) => c.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="px-2 border border-border bg-background">
              {COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        ))}
        <button type="button" onClick={() => setCols((c) => [...c, { name: '', type: 'TEXT' }])} className="text-xs underline">+ Add column</button>
      </div>
      <div className="flex gap-3 p-6 border-t border-border">
        <button onClick={onClose} className="flex-1 border border-border py-3 min-h-[44px]">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex-1 btn-primary min-h-[44px]">{saving ? 'Creating…' : 'Create'}</button>
      </div>
    </ModalShell>
  )
}

function RowModal({ title, tableName, schema, initial, onClose, onSubmit, onDone }: {
  title: string; tableName: string; schema: ColumnInfo[]; initial: Row
  onClose: () => void
  onSubmit: (t: string, id: string, row: Row) => Promise<void>
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const col of schema) {
      const v = initial[col.name]
      init[col.name] = v == null ? '' : String(v)
    }
    return init
  })
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const row: Row = {}
    for (const col of schema) {
      const raw = values[col.name]
      if (raw === '' && col.name === 'id') continue
      if (raw === '') continue
      if (col.type === 'INTEGER') row[col.name] = Number(raw)
      else if (col.type === 'REAL' || col.type === 'NUMERIC') row[col.name] = Number(raw)
      else if (col.type === 'BOOLEAN') row[col.name] = raw === 'true' || raw === '1'
      else row[col.name] = raw
    }
    setSaving(true); setErr(null)
    try {
      if (title === 'Edit Row') await onSubmit(tableName, String(initial['id'] ?? ''), row)
      else await onSubmit(tableName, '', row)
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="p-6 space-y-3 overflow-y-auto">
        {err && <p className="text-sm" style={{ color: 'var(--error)' }}>{err}</p>}
        {schema.map((col) => (
          <div key={col.name}>
            <label className="text-xs font-medium">{col.name} <span className="text-muted-foreground">{col.type}</span></label>
            <input value={values[col.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))} className="w-full mt-1 px-3 py-2 border border-border bg-background font-mono min-h-[44px]" />
          </div>
        ))}
      </div>
      <div className="flex gap-3 p-6 border-t border-border">
        <button onClick={onClose} className="flex-1 border border-border py-3 min-h-[44px]">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex-1 btn-primary min-h-[44px]">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </ModalShell>
  )
}

function DeleteModal({ tableName, row, onClose, onDelete, onDone }: {
  tableName: string; row: Row; onClose: () => void
  onDelete: (t: string, id: string) => Promise<void>; onDone: () => void
}) {
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const idVal = row['id'] != null ? String(row['id']) : null

  const submit = async () => {
    if (idVal == null) { setErr('Row has no id.'); return }
    setSaving(true); setErr(null)
    try { await onDelete(tableName, idVal); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <ModalShell title="Delete Row" onClose={onClose}>
      <div className="p-6">
        {err && <p className="text-sm" style={{ color: 'var(--error)' }}>{err}</p>}
        <p className="text-sm text-muted-foreground">Delete id={idVal ?? '—'} from {tableName}?</p>
      </div>
      <div className="flex gap-3 p-6 border-t border-border">
        <button onClick={onClose} className="flex-1 border border-border py-3 min-h-[44px]">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex-1 bg-error text-error-foreground py-3 min-h-[44px]">{saving ? 'Deleting…' : 'Delete'}</button>
      </div>
    </ModalShell>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-card border border-border w-full sm:max-w-lg flex flex-col max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 min-w-[44px] min-h-[44px]"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
