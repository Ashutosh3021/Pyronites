'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Upload, Download, Trash2, FileIcon, MoreVertical, Grid, List, X } from 'lucide-react'
import { apiUrl, getStoredProjectName, PROJECT_CHANGE_EVENT } from '@/lib/api'

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
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [projectLabel, setProjectLabel] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    setProjectLabel(getStoredProjectName())
    try {
      const res = await fetch(apiUrl('/storage'), { credentials: 'include' })
      if (!res.ok) throw new Error('list')
      const raw = (await res.json()) as RawFile[]
      setFiles(raw.map((f) => ({
        id: f.id,
        name: f.original_filename,
        size: f.size_bytes,
        uploaded: f.uploaded_at,
        type: iconForType(f.content_type),
      })))
    } catch {
      setLoadErr('Could not load files for this project.')
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFiles()
    const onChange = () => loadFiles()
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
    setOpenMenu(null)
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
      <div className="space-y-4 lg:space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Storage</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Files for <span className="text-foreground font-medium">{projectLabel ?? 'selected project'}</span>
            </p>
          </div>
          <button onClick={() => setShowUpload(true)} className="btn-primary flex items-center gap-2 min-h-[44px]">
            <Upload className="w-4 h-4" /> Upload
          </button>
        </div>

        {loadErr && <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>}

        <div className="bg-card border border-border p-4 text-sm text-muted-foreground">
          <span className="text-foreground font-medium">{formatFileSize(totalSize)}</span> used · {files.length} file(s)
        </div>

        {loading && files.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : files.length === 0 ? (
          <div className="bg-card border border-border p-12 text-center text-muted-foreground">No files in this project yet.</div>
        ) : (
          <div className="bg-card border border-border overflow-hidden">
            {files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <FileIcon className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <button onClick={() => handleDownload(file)} disabled={downloading === file.id} className="p-2 min-w-[44px] min-h-[44px]"><Download className="w-4 h-4" /></button>
                <button onClick={() => setDeleteConfirm(file.id)} className="p-2 min-w-[44px] min-h-[44px] text-error"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Upload File</h2>
            {uploadErr && <p className="text-sm" style={{ color: 'var(--error)' }}>{uploadErr}</p>}
            <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
            <div className="flex gap-3">
              <button onClick={() => setShowUpload(false)} className="flex-1 border border-border py-3 min-h-[44px]">Cancel</button>
              <button onClick={handleUpload} disabled={!uploadFile || uploading} className="flex-1 btn-primary min-h-[44px]">{uploading ? 'Uploading…' : 'Upload'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">Delete File</h2>
            <p className="text-sm text-muted-foreground">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-border py-3 min-h-[44px]">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 bg-error text-error-foreground py-3 min-h-[44px]">Delete</button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
