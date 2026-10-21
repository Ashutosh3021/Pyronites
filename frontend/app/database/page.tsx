'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Edit, Trash2, Eye, EyeOff, ArrowLeft, Database } from 'lucide-react'
import {
  apiUrl,
  getStoredProjectName,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertBanner } from '@/components/alert-banner'
import { SchemaDesigner } from '@/components/schema-designer'
import { EmptyState } from '@/components/empty-state'

interface TableInfo { name: string; rows: number }
interface ColumnInfo { name: string; type: string; pk: boolean }
interface Row { [key: string]: unknown }

export default function DatabaseExplorerPage() {
  const router = useRouter()
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
  const loadReqRef = useRef(0)

  const activeTable = selectedTable ?? tables[0]?.name ?? null

  const loadTables = useCallback(async () => {
    const reqId = ++loadReqRef.current
    setLoading(true)
    setLoadErr(null)
    setProjectLabel(getStoredProjectName())
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let loaded = false
    for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
      if (attempt > 0) await delay(attempt * 1500)
      if (reqId !== loadReqRef.current) return // superseded (project switch)
      try {
        const res = await fetch(apiUrl('/tables'), { credentials: 'include' })
        if (res.status >= 500) continue // transient (e.g. cold start) — retry
        if (!res.ok) break // definite client error — stop, keep last-good list
        const data = (await res.json()) as TableInfo[]
        if (reqId !== loadReqRef.current) return
        setTables(data)
        setSelectedTable((prev) => {
          if (prev && data.some((t) => t.name === prev)) return prev
          return data[0]?.name ?? null
        })
        loaded = true
      } catch {
        // network-level failure — retried by the loop
      }
    }
    if (reqId !== loadReqRef.current) return
    if (!loaded) {
      // Keep the last-good list: a transient failure must never blank the
      // sidebar (the bug that made tables "disappear" with no console errors).
      setLoadErr('Could not load tables for this project.')
    }
    setLoading(false)
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
      // Deliberate project switch: clear the old project's list up front so
      // only *errors* keep last-good data (a stale list must not leak across
      // projects).
      setSelectedTable(null)
      setSchema([])
      setRows([])
      setTables([])
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
      return <span className="text-ink-faint italic">null</span>
    if (typeof value === 'object') return <span>{JSON.stringify(value)}</span>
    return <span className="text-ink">{String(value)}</span>
  }

  const handleCreateTable = async (
    name: string,
    cols: Record<string, string | boolean>[],
    primaryKey: string | null
  ) => {
    const res = await fetch(apiUrl('/tables'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ table: name, columns: cols, primary_key: primaryKey }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail = body?.detail
      const message =
        (Array.isArray(detail) ? detail[0]?.msg : undefined) ??
        body?.message ??
        detail?.message ??
        'Failed to create table.'
      throw new Error(String(message).replace(/^Value error,\s*/, ''))
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
      <PageHeader
        meta="Schema and rows"
        title="Database"
        description={`Tables for ${projectLabel ?? 'the selected project'} only. Data is isolated per project, so nothing here can reach another project's file.`}
        actions={
          <Button onClick={() => setShowNewTable(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            New table
          </Button>
        }
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Table list */}
        <div
          className={[
            'plate p-4 flex flex-col lg:w-64 lg:flex-shrink-0',
            showingTableOnMobile ? 'hidden lg:flex' : 'flex w-full lg:w-64',
          ].join(' ')}
        >
          <p className="label mb-3">Tables</p>
          <div className="space-y-0.5 flex-1 overflow-auto">
            {tables.length === 0 && !loading && (
              <EmptyState
                compact
                icon={Database}
                title="No tables yet"
                description="Create your first table to start storing rows."
                action={{ label: 'New table', onClick: () => setShowNewTable(true) }}
                secondaryAction={{ label: 'Use SQL editor', onClick: () => router.push('/sql-editor') }}
              />
            )}
            {tables.map((table) => (
              <button
                key={table.name}
                onClick={() => selectTable(table.name)}
                aria-current={activeTable === table.name ? 'true' : undefined}
                className={[
                  'seam-open w-full px-3 py-2.5 text-left min-h-[44px] transition-colors',
                  activeTable === table.name
                    ? 'bg-plate-raised text-ink'
                    : 'text-ink-muted hover:text-ink hover:bg-plate-raised/60',
                ].join(' ')}
              >
                <div className="text-[13px] font-medium truncate">{table.name}</div>
                <div className="data text-[11px] text-ink-faint">{table.rows} rows</div>
              </button>
            ))}
          </div>
        </div>

        {/* Table detail */}
        <div
          className={[
            'flex-1 flex flex-col gap-4 min-w-0',
            !showingTableOnMobile ? 'hidden lg:flex' : 'flex',
          ].join(' ')}
        >
          {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

          <div className="plate px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setSelectedTable(null)}
                className="lg:hidden p-2 -ml-1 text-ink-muted hover:text-ink min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Back to the table list"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <h2 className="text-[15px] font-semibold truncate text-ink">
                {activeTable ?? 'No table selected'}
              </h2>
              <span className="data text-[12px] text-ink-faint">{rows.length} rows</span>
              <div className="ml-auto flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Filter rows"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-40 lg:w-48"
                  aria-label="Filter rows in this table"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowColumns(!showColumns)}
                  aria-label={showColumns ? 'Hide column types' : 'Show column types'}
                  aria-pressed={showColumns}
                >
                  {showColumns ? <Eye className="w-4 h-4" aria-hidden="true" /> : <EyeOff className="w-4 h-4" aria-hidden="true" />}
                </Button>
                <Button onClick={() => setShowInsert(true)} disabled={!activeTable}>
                  Insert row
                </Button>
              </div>
            </div>
          </div>

          <div className="plate overflow-auto">
            {!activeTable ? (
              <EmptyState
                icon={Database}
                title="Select or create a table"
                description="Pick a table on the left to read its rows, or create a new one to start."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    {showColumns &&
                      schema.map((col) => (
                        <TableHead key={col.name}>
                          <div className="text-ink text-[11px] uppercase tracking-[0.1em]">{col.name}</div>
                          <div className="data text-[10px] text-ink-faint normal-case tracking-normal">
                            {col.type}
                            {col.pk ? ' · PK' : ''}
                          </div>
                        </TableHead>
                      ))}
                    <TableHead className="w-24">
                      <span className="sr-only">Row actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row, idx) => (
                    <TableRow key={row.id ? String(row.id) : `row-${idx}`}>
                      <TableCell className="data text-[11px] text-ink-faint">{idx + 1}</TableCell>
                      {showColumns &&
                        schema.map((col) => (
                          <TableCell key={col.name} className="data text-[12px]">
                            {renderCell(row[col.name])}
                          </TableCell>
                        ))}
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditRow(row)}
                            aria-label={`Edit row ${idx + 1}`}
                          >
                            <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteRow(row)}
                            aria-label={`Delete row ${idx + 1}`}
                            className="text-error hover:text-error"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
            <div className="flex justify-between items-center text-[12px] text-ink-faint">
              <span className="data">
                Showing {filteredRows.length} loaded rows
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset <= 0}
                  onClick={() => loadTable(activeTable, Math.max(0, offset - LIMIT))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rows.length < LIMIT}
                  onClick={() => loadTable(activeTable, offset + LIMIT)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <SchemaDesigner
        open={showNewTable}
        onClose={() => setShowNewTable(false)}
        onCreate={handleCreateTable}
        onDone={(name) => { setShowNewTable(false); loadTables().then(() => selectTable(name)) }}
      />

      {showInsert && activeTable && (
        <RowModal title="Insert row" tableName={activeTable} schema={schema} initial={{}} open={showInsert} onClose={() => setShowInsert(false)} onSubmit={async (t, _id, row) => handleInsertRow(t, row)} onDone={() => { setShowInsert(false); loadTable(activeTable, offset) }} />
      )}

      {editRow && activeTable && (
        <RowModal title="Edit row" tableName={activeTable} schema={schema} initial={editRow} open={!!editRow} onClose={() => setEditRow(null)} onSubmit={handleEditRow} onDone={() => { setEditRow(null); loadTable(activeTable, offset) }} />
      )}

      {deleteRow && activeTable && (
        <DeleteModal tableName={activeTable} row={deleteRow} open={!!deleteRow} onClose={() => setDeleteRow(null)} onDelete={handleDeleteRow} onDone={() => { setDeleteRow(null); loadTable(activeTable, offset) }} />
      )}
    </PyroCoreLayout>
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
              <label className="flex items-baseline gap-2 text-[13px] font-medium text-ink">
                {col.name} <span className="data text-[11px] text-ink-faint">{col.type}</span>
              </label>
              <Input
                value={values[col.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                className="data text-[12px]"
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
          <DialogTitle>Delete row</DialogTitle>
          <DialogDescription>
            This cannot be undone. The row is removed from {tableName} for good.
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
