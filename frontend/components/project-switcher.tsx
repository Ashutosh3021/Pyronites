'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Plus } from 'lucide-react'
import {
  fetchProjects,
  fetchCurrentProjectId,
  selectProject,
  getStoredProjectId,
  getStoredProjectName,
  setStoredProject,
  isDefaultProject,
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
      return
    }
    // Prefer the server-side "current project" (last used) so reads and writes
    // target the same database file, even with no client-side selection.
    const serverId = await fetchCurrentProjectId()
    const serverMatch =
      serverId && list.find((p) => p.id === serverId || p.project_id === serverId)
    const chosen = serverMatch ?? list.find(isDefaultProject) ?? list[0]
    if (chosen) {
      setStoredProject({ id: chosen.id, name: chosen.name })
      setCurrentId(chosen.id)
      setCurrentName(chosen.name)
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
    // Persist server-side so other clients / reloads resolve the same DB.
    void selectProject(p.id)
    // Soft reload page data without full navigation
    window.location.reload()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="seam-open w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] border border-seam bg-plate-raised hover:border-seam-strong transition-colors min-h-[44px]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="w-[7px] h-[7px] rotate-45 flex-shrink-0"
          style={{ background: 'var(--accent)' }}
          aria-hidden="true"
        />
        <span className="flex-1 text-left truncate text-ink font-medium">{currentName}</span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-ink-muted" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            aria-label="Projects"
            className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-seam max-h-64 overflow-auto"
          >
            {projects.length === 0 ? (
              <p className="px-3 py-2.5 text-[12.5px] text-muted-foreground">No projects yet</p>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={currentId === p.id}
                  onClick={() => select(p)}
                  className={[
                    'w-full text-left px-3 py-2.5 text-[13px] min-h-[44px] transition-colors',
                    currentId === p.id
                      ? 'bg-plate-raised text-accent'
                      : 'text-ink hover:bg-plate-raised',
                  ].join(' ')}
                >
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="data text-[11px] text-ink-faint truncate">{p.slug || p.project_id}</div>
                </button>
              ))
            )}
            <Link
              href="/new-project"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 text-[13px] border-t border-seam text-ink-muted hover:text-ink hover:bg-plate-raised transition-colors min-h-[44px]"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New project
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
