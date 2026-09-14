'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState, useEffect, useCallback } from 'react'
import { Upload, Download, Trash2, FileIcon } from 'lucide-react'
import { apiUrl, getStoredProjectName, PROJECT_CHANGE_EVENT } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { AlertBanner } from '@/components/alert-banner'

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
              {' '}— data is isolated per project.
            </p>
          </div>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="w-4 h-4 mr-2" /> Upload
          </Button>
        </div>

        {loadErr && <AlertBanner variant="error" message={loadErr} onDismiss={() => setLoadErr(null)} />}

        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{formatFileSize(totalSize)}</span> used · {files.length} file(s)
          </CardContent>
        </Card>

        {loading && files.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : files.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No files in this project yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-border">
              {files.map((file) => (
                <div key={file.id} className="flex items-center gap-3 px-4 py-3">
                  <FileIcon className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownload(file)}
                    disabled={downloading === file.id}
                    aria-label={`Download ${file.name}`}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirm(file.id)}
                    aria-label={`Delete ${file.name}`}
                    className="text-error hover:text-error"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={(isOpen) => !isOpen && setShowUpload(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
            <DialogDescription>Select a file to upload to your project storage.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {uploadErr && <AlertBanner variant="error" message={uploadErr} onDismiss={() => setUploadErr(null)} />}
            <div className="space-y-2">
              <label className="text-sm font-medium">Select File</label>
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(isOpen) => !isOpen && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>This action cannot be undone. The file will be permanently deleted.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">Are you sure you want to delete this file?</p>
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
