import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format bytes to human readable string
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

// Format ISO date to relative time string
export function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Unknown'
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// Get color variable for log level
export function levelColor(level: string): string {
  switch (level) {
    case 'success':
      return 'var(--success)'
    case 'warning':
      return 'var(--warning)'
    case 'error':
      return 'var(--error)'
    default:
      return 'var(--pyro-orange)'
  }
}

// Get CSS class for log level dot
export function levelDotClass(level: string): string {
  switch (level) {
    case 'error':
      return 'bg-error'
    case 'warning':
      return 'bg-warning'
    case 'success':
      return 'bg-success'
    default:
      return 'bg-info'
  }
}

// Get CSS class for log level badge
export function levelBadgeClass(level: string): string {
  switch (level) {
    case 'error':
      return 'bg-error/15 text-error'
    case 'warning':
      return 'bg-warning/15 text-warning'
    case 'success':
      return 'bg-success/15 text-success'
    default:
      return 'bg-info/15 text-info'
  }
}

// Get CSS class for status code
export function statusCodeClass(code: number): string {
  if (code >= 200 && code < 300) return 'text-success'
  if (code >= 400 && code < 500) return 'bg-warning/15 text-warning'
  if (code >= 500) return 'bg-error/15 text-error'
  return ''
}

// Format ISO date to readable string
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Format file size
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

// Get icon type for file content type
export function iconForType(contentType: string): string {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.includes('json')) return 'code'
  return 'file'
}
