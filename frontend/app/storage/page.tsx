'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, Download, Trash2, FileIcon, FileText } from 'lucide-react'
import { apiUrl, getStoredProjectName, PROJECT_CHANGE_EVENT } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertBanner } from '@/components/alert-banner'
import { EmptyState } from '@/components/empty-state'

interface StorageFile {
  id: string
  name: string
  size: number
  uploaded: string
  type: string
}

interface RawFile {
  id: string
  original_filename: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  project_id: string
}

const formatFileSize = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) { size /= 1024; unitIndex++ }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

function iconForType(contentType: string): string {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.includes('json')) return 'code'
  return 'file'
}

export default function StoragePage() {
  const [files, setFiles] = useState<StorageFile[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [projectLabel, setProjectLabel] = useState<string | null>(null)
  const loadReqRef = useRef(0)

  const loadFiles = useCallback(async () => {
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
        const res = await fetch(apiUrl('/storage'), { credentials: 'include' })
        if (res.status >= 500) continue // transient (e.g. cold start) — retry
        if (!res.ok) break // definite client error — stop, keep last-good list
        const raw = (await res.json()) as RawFile[]
        if (reqId !== loadReqRef.current) return
        setFiles(raw.map((f) => ({
          id: f.id,
          name: f.original_filename,
          size: f.size_bytes,
          uploaded: f.uploaded_at,
          type: iconForType(f.content_type),
        })))
        loaded = true
      } catch {
        // network-level failure — retried by the loop
      }
    }
    if (reqId !== loadReqRef.current) return
    if (!loaded) {
      // Keep the last-good list — a transient failure must not blank it.
      setLoadErr('Could not load files for this project.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadFiles()
    const onChange = () => {
      // Deliberate project switch: clear the old project's list up front so
      // only *errors* keep last-good data.
      setFiles([])
      loadFiles()
    }
    window.addEventListener(PROJECT_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, onChange)
  }, [loadFiles])

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadErr(null)
    try {
      const form = new FormData()
      form.append('file', uploadFile)
      const res = await fetch(apiUrl('/storage/upload'), {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Upload failed.')
      }
      setShowUpload(false)
      setUploadFile(null)
      loadFiles()
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async (file: StorageFile) => {
    setDownloading(file.id)
    try {
      const res = await fetch(apiUrl(`/storage/${file.id}/download`), { credentials: 'include' })
      if (!res.ok) throw new Error('Download failed.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Download failed.')
    } finally {
      setDownloading(null)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/storage/${id}`), { method: 'DELETE', credentials: 'include' })
      if (!res.ok) throw new Error('Delete failed.')
      setFiles((prev) => prev.filter((f) => f.id !== id))
      setDeleteConfirm(null)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Delete failed.')
      setDeleteConfirm(null)
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  return (
    <PyroCoreLayout>
      <PageHeader
        meta="Project files"
        title="Storage"
        description={`Files for ${projectLabel ?? 'the selected project'}. Each project has its own bucket, so an upload here never shows up in another project.`}
        actions={
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="w-4 h-4" aria-hidden="true" />
            Upload
          </Button>
        }
      />

      {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

      <dl className="mt-8 grid grid-cols-2 gap-px bg-seam border border-seam">
        <div className="bg-plate p-5">
          <dt className="label">Used</dt>
          <dd className="data mt-3 text-[26px] leading-none text-ink">{formatFileSize(totalSize)}</dd>
        </div>
        <div className="bg-plate p-5">
          <dt className="label">Files</dt>
          <dd className="data mt-3 text-[26px] leading-none text-ink">{files.length}</dd>
        </div>
      </dl>

      {loading && files.length === 0 ? (
        <div className="plate p-12 text-center text-[13px] text-ink-muted">Loading files</div>
      ) : files.length === 0 ? (
        <div className="plate mt-6">
          <EmptyState
            icon={FileText}
            title="No files in this project yet"
            description="Upload a file and it gets a URL your app can fetch it from."
            action={{ label: 'Upload file', onClick: () => setShowUpload(true) }}
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <ul className="divide-y divide-seam">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 px-4 py-3 hover:bg-plate-raised/60 transition-colors">
                <FileIcon className="w-4 h-4 text-ink-muted flex-shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink truncate">{file.name}</p>
                  <p className="data text-[11px] text-ink-faint">{formatFileSize(file.size)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDownload(file)}
                  disabled={downloading === file.id}
                  aria-label={`Download ${file.name}`}
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeleteConfirm(file.id)}
                  aria-label={`Delete ${file.name}`}
                  className="text-error hover:text-error"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={showUpload} onOpenChange={(isOpen) => !isOpen && setShowUpload(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload a file</DialogTitle>
            <DialogDescription>
              The file is written to this project&rsquo;s storage and served from its own URL.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {uploadErr && <AlertBanner variant="error" message={uploadErr} onDismiss={() => setUploadErr(null)} />}
            <div className="space-y-2">
              <label htmlFor="storage-file" className="block text-[13px] font-medium text-ink">
                File
              </label>
              <input
                id="storage-file"
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-[13px] text-ink-muted file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-accent hover:file:text-hot"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
              {uploading ? 'Uploading' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(isOpen) => !isOpen && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
            <DialogDescription>
              The file is removed from this project&rsquo;s storage. There is no undo.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-[13px] text-ink-muted">
              Delete <span className="data text-ink">{files.find((f) => f.id === deleteConfirm)?.name ?? 'this file'}</span>?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PyroCoreLayout>
  )
}
