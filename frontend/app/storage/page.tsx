'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Upload, Download, Trash2, FileIcon, MoreVertical, Grid, List, X } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

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
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.includes('json') || contentType.includes('javascript')) return 'code'
  if (contentType.includes('zip') || contentType.includes('tar') || contentType.includes('compressed')) return 'archive'
  if (contentType.includes('text') || contentType.includes('pdf') || contentType.includes('csv') || contentType.includes('document')) return 'document'
  return 'file'
}

export default function StoragePage() {
  const [files, setFiles] = useState<StorageFile[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [path] = useState('/')
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const res = await fetch(`${API_BASE}/storage`, { credentials: 'include' })
      if (!res.ok) throw new Error('list')
      const raw = (await res.json()) as RawFile[]
      setFiles(
        raw.map((f) => ({
          id: f.id,
          name: f.original_filename,
          size: f.size_bytes,
          uploaded: f.uploaded_at,
          type: iconForType(f.content_type),
        })),
      )
    } catch {
      setLoadErr('Could not load files. Is the backend running on :8000?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadErr(null)
    try {
      const form = new FormData()
      form.append('file', uploadFile)
      const res = await fetch(`${API_BASE}/storage/upload`, {
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

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/storage/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Delete failed.')
      }
      setFiles((prev) => prev.filter((f) => f.id !== id))
      setDeleteConfirm(null)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Delete failed.')
      setDeleteConfirm(null)
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  const maxSize = 107374182400

  return (
    <PyroCoreLayout>
      <div className="space-y-4 lg:space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Storage</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your uploaded files</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="btn-primary flex items-center gap-2 flex-shrink-0 min-h-[44px]">
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload File</span>
            <span className="sm:hidden">Upload</span>
          </button>
        </div>

        {loadErr && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{loadErr}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <span className="text-foreground">{path}</span>
          </div>
          <div className="flex gap-1 border border-border p-1 bg-background">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center ${
                viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center ${
                viewMode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Grid className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-card border border-border p-4">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{formatFileSize(totalSize)}</span>
            {' '}used of{' '}
            <span className="text-foreground font-medium">{formatFileSize(maxSize)}</span>
          </p>
        </div>

        {loading && files.length === 0 ? (
          <div className="bg-card border border-border p-12 text-center text-muted-foreground">Loading…</div>
        ) : files.length === 0 ? (
          <div className="bg-card border border-border p-12 text-center">
            <p className="text-muted-foreground mb-4">No files yet. Upload your first file.</p>
            <button onClick={() => setShowUpload(true)} className="btn-primary inline-flex items-center gap-2 min-h-[44px]">
              <Upload className="w-4 h-4" />Upload File
            </button>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-card border border-border overflow-hidden">
            <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 border-b border-border bg-muted/30">
              <div className="text-xs font-semibold text-foreground">Filename</div>
              <div className="text-xs font-semibold text-foreground">Size</div>
              <div className="text-xs font-semibold text-foreground">Uploaded</div>
              <div className="text-xs font-semibold text-foreground">Actions</div>
            </div>

            {files.map((file) => (
              <div key={file.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 items-center">
                  <div className="flex items-center gap-2">
                    <FileIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-foreground truncate">{file.name}</span>
                  </div>
                  <div className="text-sm font-mono text-muted-foreground">{formatFileSize(file.size)}</div>
                  <div className="text-sm font-mono text-muted-foreground">
                    {new Date(file.uploaded).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setOpenMenu(openMenu === file.id ? null : file.id)}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {openMenu === file.id && (
                      <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-10 min-w-40 overflow-hidden">
                        <a
                          href={`${API_BASE}/storage/${file.id}/download`}
                          className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 min-h-[44px]"
                        >
                          <Download className="w-4 h-4" />Download
                        </a>
                        <button
                          onClick={() => { setDeleteConfirm(file.id); setOpenMenu(null) }}
                          className="w-full px-4 py-3 text-left text-sm text-error hover:bg-error/10 transition-colors flex items-center gap-2 min-h-[44px]"
                        >
                          <Trash2 className="w-4 h-4" />Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:hidden flex items-center gap-3 px-4 py-3 min-h-[56px]">
                  <FileIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatFileSize(file.size)} · {new Date(file.uploaded).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={`${API_BASE}/storage/${file.id}/download`}
                      className="p-2 text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => setDeleteConfirm(file.id)}
                      className="p-2 text-muted-foreground hover:text-error transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {files.map((file) => (
              <div key={file.id} className="bg-card border border-border p-4">
                <div className="flex items-center justify-center h-20 bg-muted/50 mb-3">
                  <FileIcon className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium text-foreground truncate mb-1">{file.name}</h3>
                <p className="text-xs text-muted-foreground mb-1">{formatFileSize(file.size)}</p>
                <p className="text-xs text-muted-foreground mb-3">{new Date(file.uploaded).toLocaleDateString()}</p>
                <button
                  onClick={() => setDeleteConfirm(file.id)}
                  className="w-full px-2 py-2 text-xs text-error hover:bg-error/10 transition-colors min-h-[36px]"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── UPLOAD MODAL ── */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Upload File</h2>
              <button onClick={() => { setShowUpload(false); setUploadErr(null) }} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 p-6 space-y-3">
              {uploadErr && <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>{uploadErr}</p>}
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-foreground file:mr-3 file:px-3 file:py-2 file:bg-muted file:text-foreground file:border-0 file:min-h-[44px]"
              />
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => { setShowUpload(false); setUploadErr(null) }} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">Cancel</button>
              <button onClick={handleUpload} disabled={!uploadFile || uploading} className="flex-1 px-4 py-3 btn-primary text-sm font-medium hover:bg-accent/90 transition-colors min-h-[44px] disabled:opacity-70 flex items-center justify-center gap-2">
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE MODAL ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-card border border-border w-full sm:max-w-sm flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4">
              <h2 className="text-lg font-semibold text-foreground">Delete File</h2>
              <button onClick={() => setDeleteConfirm(null)} className="p-2 text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground px-6 pb-6">This action cannot be undone.</p>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px]">Delete</button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
