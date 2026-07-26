'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, FolderKanban, Plus } from 'lucide-react'
import {
  fetchProjects,
  getStoredProjectId,
  getStoredProjectName,
  setStoredProject,
  PROJECT_CHANGE_EVENT,
  type ProjectSummary,
} from '@/lib/api'

export function ProjectSwitcher() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [open, setOpen] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [currentName, setCurrentName] = useState<string>('Select project')

  const syncFromStorage = useCallback(() => {
    setCurrentId(getStoredProjectId())
    setCurrentName(getStoredProjectName() ?? 'Select project')
  }, [])

  const load = useCallback(async () => {
    const list = await fetchProjects()
    setProjects(list)
    const stored = getStoredProjectId()
    if (stored && list.some((p) => p.id === stored || p.project_id === stored)) {
      const match = list.find((p) => p.id === stored || p.project_id === stored)!
      setStoredProject({ id: match.id, name: match.name })
      setCurrentId(match.id)
      setCurrentName(match.name)
    } else if (list.length > 0) {
      // Default to first active project
      const first = list[0]
      setStoredProject({ id: first.id, name: first.name })
      setCurrentId(first.id)
      setCurrentName(first.name)
    }
  }, [])

  useEffect(() => {
    load()
    const onChange = () => {
      syncFromStorage()
    }
    window.addEventListener(PROJECT_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, onChange)
  }, [load, syncFromStorage])

  const select = (p: ProjectSummary) => {
    setStoredProject({ id: p.id, name: p.name })
    setCurrentId(p.id)
    setCurrentName(p.name)
    setOpen(false)
    // Soft reload page data without full navigation
    window.location.reload()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm border border-border bg-background hover:bg-muted/40 transition-colors min-h-[44px]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FolderKanban className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate text-foreground font-medium">
          {currentName}
        </span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border shadow-lg max-h-64 overflow-auto">
            {projects.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No projects yet</p>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => select(p)}
                  className={[
                    'w-full text-left px-3 py-2.5 text-sm min-h-[44px] hover:bg-muted/50 transition-colors',
                    currentId === p.id ? 'bg-muted text-accent' : 'text-foreground',
                  ].join(' ')}
                >
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {p.slug || p.project_id}
                  </div>
                </button>
              ))
            )}
            <Link
              href="/new-project"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 text-sm border-t border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              New project
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
