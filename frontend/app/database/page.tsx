'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Edit, Trash2, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import {
  apiUrl,
  getStoredProjectName,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertBanner } from '@/components/alert-banner'

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
          {' '}only — data is isolated per project. Switch projects in the sidebar.
        </p>
      </div>

      <div className="h-full flex gap-6">
        <div className={['bg-card border border-border rounded-lg p-4 flex flex-col', 'lg:w-64 lg:flex-shrink-0', showingTableOnMobile ? 'hidden lg:flex' : 'flex w-full lg:w-64'].join(' ')}>
          <div className="mb-4">
            <Button onClick={() => setShowNewTable(true)} className="w-full">
              <Plus className="w-4 h-4 mr-2" /> New Table
            </Button>
          </div>
          <div className="space-y-1 flex-1 overflow-auto">
            {tables.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground px-1">No tables in this project yet.</p>
            )}
            {tables.map((table) => (
              <button key={table.name} onClick={() => selectTable(table.name)} className={['w-full px-3 py-3 text-sm text-left min-h-[44px] rounded-md transition-colors', activeTable === table.name ? 'bg-muted text-accent' : 'text-muted-foreground hover:bg-muted/50'].join(' ')}>
                <div className="font-medium">{table.name}</div>
                <div className="text-xs text-muted-foreground">{table.rows} rows</div>
              </button>
            ))}
          </div>
        </div>

        <div className={['flex-1 flex flex-col gap-4 min-w-0', !showingTableOnMobile ? 'hidden lg:flex' : 'flex'].join(' ')}>
          {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedTable(null)} className="lg:hidden p-2 min-w-[44px] min-h-[44px]" aria-label="Back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-base font-semibold truncate">Table: <span className="text-accent">{activeTable ?? '—'}</span></h2>
              <span className="text-sm text-muted-foreground">{rows.length} rows</span>
              <div className="ml-auto hidden lg:flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Filter..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-48"
                />
                <Button variant="ghost" size="icon" onClick={() => setShowColumns(!showColumns)}>
                  {showColumns ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </Button>
                <Button onClick={() => setShowInsert(true)} disabled={!activeTable}>
                  Insert Row
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-card border border-border rounded-lg overflow-auto">
            {!activeTable ? (
              <div className="p-12 text-center text-muted-foreground">Select or create a table.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    {showColumns && schema.map((col) => (
                      <TableHead key={col.name}>
                        <div className="font-semibold">{col.name}</div>
                        <div className="font-mono text-muted-foreground text-xs">{col.type}{col.pk ? ' · PK' : ''}</div>
                      </TableHead>
                    ))}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row, idx) => (
                    <TableRow key={row.id ? String(row.id) : `row-${idx}`}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      {showColumns && schema.map((col) => (
                        <TableCell key={col.name} className="font-mono text-sm">{renderCell(row[col.name])}</TableCell>
                      ))}
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setEditRow(row)} aria-label="Edit">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteRow(row)} aria-label="Delete" className="text-error hover:text-error">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {activeTable && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Showing {filteredRows.length} loaded</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={offset <= 0} onClick={() => loadTable(activeTable, Math.max(0, offset - LIMIT))}>
                  ← Prev
                </Button>
                <Button variant="ghost" size="sm" disabled={rows.length < LIMIT} onClick={() => loadTable(activeTable, offset + LIMIT)}>
                  Next →
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <NewTableModal open={showNewTable} onClose={() => setShowNewTable(false)} onCreate={handleCreateTable} onDone={(name) => { setShowNewTable(false); loadTables().then(() => selectTable(name)) }} />
      
      {showInsert && activeTable && (
        <RowModal title="Insert Row" tableName={activeTable} schema={schema} initial={{}} open={showInsert} onClose={() => setShowInsert(false)} onSubmit={async (t, _id, row) => handleInsertRow(t, row)} onDone={() => { setShowInsert(false); loadTable(activeTable, offset) }} />
      )}
      
      {editRow && activeTable && (
        <RowModal title="Edit Row" tableName={activeTable} schema={schema} initial={editRow} open={!!editRow} onClose={() => setEditRow(null)} onSubmit={handleEditRow} onDone={() => { setEditRow(null); loadTable(activeTable, offset) }} />
      )}
      
      {deleteRow && activeTable && (
        <DeleteModal tableName={activeTable} row={deleteRow} open={!!deleteRow} onClose={() => setDeleteRow(null)} onDelete={handleDeleteRow} onDone={() => { setDeleteRow(null); loadTable(activeTable, offset) }} />
      )}
    </PyroCoreLayout>
  )
}

function NewTableModal({ open, onClose, onCreate, onDone }: { open: boolean; onClose: () => void; onCreate: (name: string, cols: { name: string; type: string }[]) => Promise<void>; onDone: (name: string) => void }) {
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Table</DialogTitle>
          <DialogDescription>Create a new table in your database.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr(null)} />}
          <div className="space-y-2">
            <label className="text-sm font-medium">Table Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="table_name"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Columns</label>
            <div className="space-y-2">
              {cols.map((col, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={col.name}
                    onChange={(e) => setCols((c) => c.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    className="flex-1 font-mono"
                    placeholder="column_name"
                  />
                  <Select value={col.type} onValueChange={(value) => setCols((c) => c.map((x, j) => j === i ? { ...x, type: value } : x))}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLUMN_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCols((c) => [...c, { name: '', type: 'TEXT' }])}>
              + Add column
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RowModal({ title, tableName, schema, initial, open, onClose, onSubmit, onDone }: {
  title: string; tableName: string; schema: ColumnInfo[]; initial: Row
  open: boolean
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr(null)} />}
          {schema.map((col) => (
            <div key={col.name} className="space-y-1.5">
              <label className="text-sm font-medium">
                {col.name} <span className="text-muted-foreground text-xs">{col.type}</span>
              </label>
              <Input
                value={values[col.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                className="font-mono"
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteModal({ tableName, row, open, onClose, onDelete, onDone }: {
  tableName: string; row: Row; open: boolean; onClose: () => void
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Row</DialogTitle>
          <DialogDescription>
            This action cannot be undone. The row will be permanently deleted from {tableName}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr(null)} />}
          <p className="text-sm text-muted-foreground">
            Delete id=<span className="font-mono text-foreground">{idVal ?? '—'}</span> from {tableName}?
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
