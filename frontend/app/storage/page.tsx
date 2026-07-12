'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Upload, Download, Copy, Trash2, FileIcon, MoreVertical, Grid, List, X } from 'lucide-react'

interface StorageFile {
  id: string
  name: string
  size: number
  uploaded: string
  type: string
}

const files: StorageFile[] = [
  { id: '1', name: 'user-avatar-123.jpg', size: 2457600, uploaded: '2024-02-20', type: 'image' },
  { id: '2', name: 'export-data-2024.csv', size: 1572864, uploaded: '2024-02-18', type: 'document' },
  { id: '3', name: 'backup-schema.sql', size: 345600, uploaded: '2024-02-15', type: 'code' },
  { id: '4', name: 'logs-archive.zip', size: 5242880, uploaded: '2024-02-10', type: 'archive' },
]

const formatFileSize = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes, unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) { size /= 1024; unitIndex++ }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

export default function StoragePage() {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [path] = useState('/')

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  const maxSize = 107374182400

  return (
    <PyroCoreLayout>
      <div className="space-y-4 lg:space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Storage</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your uploaded files</p>
          </div>
          <button className="btn-primary flex items-center gap-2 flex-shrink-0 min-h-[44px]">
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload File</span>
            <span className="sm:hidden">Upload</span>
          </button>
        </div>

        {/* Breadcrumb + view toggle */}
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

        {/* Storage summary */}
        <div className="bg-card border border-border p-4">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{formatFileSize(totalSize)}</span>
            {' '}used of{' '}
            <span className="text-foreground font-medium">{formatFileSize(maxSize)}</span>
          </p>
        </div>

        {files.length === 0 ? (
          <div className="bg-card border border-border p-12 text-center">
            <p className="text-muted-foreground mb-4">No files yet. Upload your first file.</p>
            <button className="btn-primary inline-flex items-center gap-2 min-h-[44px]">
              <Upload className="w-4 h-4" />Upload File
            </button>
          </div>
        ) : viewMode === 'list' ? (
          <div className="bg-card border border-border overflow-hidden">
            {/* Desktop headers */}
            <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 border-b border-border bg-muted/30">
              <div className="text-xs font-semibold text-foreground">Filename</div>
              <div className="text-xs font-semibold text-foreground">Size</div>
              <div className="text-xs font-semibold text-foreground">Uploaded</div>
              <div className="text-xs font-semibold text-foreground">Actions</div>
            </div>

            {files.map((file) => (
              <div key={file.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                {/* Desktop row */}
                <div className="hidden lg:grid lg:grid-cols-4 gap-4 px-6 py-4 items-center">
                  <div className="flex items-center gap-2">
                    <FileIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-foreground truncate">{file.name}</span>
                  </div>
                  <div className="text-sm font-mono text-muted-foreground">{formatFileSize(file.size)}</div>
                  <div className="text-sm font-mono text-muted-foreground">{file.uploaded}</div>
                  <div className="relative">
                    <button
                      onClick={() => setOpenMenu(openMenu === file.id ? null : file.id)}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {openMenu === file.id && (
                      <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-10 min-w-40 overflow-hidden">
                        <button className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 min-h-[44px]">
                          <Download className="w-4 h-4" />Download
                        </button>
                        <button className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2 min-h-[44px]">
                          <Copy className="w-4 h-4" />Copy URL
                        </button>
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

                {/* Mobile row — name + size, actions always visible */}
                <div className="lg:hidden flex items-center gap-3 px-4 py-3 min-h-[56px]">
                  <FileIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatFileSize(file.size)} · {file.uploaded}
                    </p>
                  </div>
                  {/* Inline actions on mobile — always visible */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button className="p-2 text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center" title="Download">
                      <Download className="w-4 h-4" />
                    </button>
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
          /* Grid view — 1 col mobile, 2 tablet, 3 desktop, 4 large desktop */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {files.map((file) => (
              <div key={file.id} className="bg-card border border-border p-4">
                <div className="flex items-center justify-center h-20 bg-muted/50 mb-3">
                  <FileIcon className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium text-foreground truncate mb-1">{file.name}</h3>
                <p className="text-xs text-muted-foreground mb-1">{formatFileSize(file.size)}</p>
                <p className="text-xs text-muted-foreground mb-3">{file.uploaded}</p>
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

      {/* ── DELETE MODAL — full-screen on mobile ── */}
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
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 bg-error text-error-foreground text-sm font-medium hover:bg-error/90 transition-colors min-h-[44px]">Delete</button>
            </div>
          </div>
        </div>
      )}
    </PyroCoreLayout>
  )
}
