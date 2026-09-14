// Shared types for the PyroCore frontend

export interface Stats {
  table_count: number
  file_count: number
  key_count: number
  db_size_bytes: number
  last_backup: string | null
  project: {
    id?: string
    project_id: string
    project_name: string
    backup_interval: string
    created_at?: string
    storage_location?: string
  } | null
}

export interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success'
  action: string
  statusCode?: number
}

export interface TableInfo {
  name: string
  rows: number
}

export interface ColumnInfo {
  name: string
  type: string
  pk: boolean
}

export interface Row {
  [key: string]: unknown
}

export interface ProjectDetail {
  id: string
  project_id: string
  slug?: string
  name: string
  status?: string
  backup_interval?: string
  storage_location?: string
  created_at?: string
  updated_at?: string
}

export interface Backup {
  name: string
  created_at: string
  size_bytes: number
}

export interface ApiKey {
  id: string
  name: string
  masked: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
}

export interface StorageFile {
  id: string
  name: string
  size: number
  uploaded: string
  type: string
}

export interface RawFile {
  id: string
  original_filename: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  project_id: string
}

export interface User {
  id: string
  email: string
  created: string
  lastSignIn: string
  status: 'active' | 'disabled'
}

export interface Session {
  id: string
  userEmail: string
  created: string
  expires: string
}

export interface RawUser {
  id: string
  email: string
  created_at: string
  is_active: boolean
}

export interface RawSession {
  id: string
  user_email: string
  created_at: string
  expires_at: string
}
