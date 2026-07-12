'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useState } from 'react'
import { Copy, AlertTriangle } from 'lucide-react'

const settingsTabs = [
  { id: 'general', label: 'General' },
  { id: 'database', label: 'Database' },
  { id: 'api', label: 'API' },
  { id: 'danger', label: 'Danger Zone' },
] as const

type Tab = typeof settingsTabs[number]['id']

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')
  const [projectName, setProjectName] = useState('my-project')
  const [walMode, setWalMode] = useState(true)
  const [backupInterval, setBackupInterval] = useState('1hour')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text) }

  return (
    <PyroCoreLayout>
      <div className="max-w-4xl space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your project configuration</p>
        </div>

        {/*
          Layout:
          Desktop: left sub-nav column + content
          Mobile/tablet: horizontal scrollable tab bar + content stacked
        */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">

          {/* ── MOBILE: horizontal tab bar ── */}
          <div className="flex lg:hidden gap-1 border-b border-border overflow-x-auto pb-0 -mb-px">
            {settingsTabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors min-h-[44px] flex-shrink-0 ${
                  tab === item.id
                    ? 'border-accent text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* ── DESKTOP: vertical sub-nav ── */}
          <div className="hidden lg:flex w-48 flex-col gap-1 flex-shrink-0">
            {settingsTabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-4 py-2 text-sm font-medium text-left transition-colors min-h-[44px] ${
                  tab === item.id
                    ? 'bg-muted text-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* ── CONTENT AREA ── */}
          <div className="flex-1 min-w-0">

            {/* General */}
            {tab === 'general' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Project Name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Project ID</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      proj_a1b2c3d4e5f6g7h8
                    </code>
                    <button
                      onClick={() => copyToClipboard('proj_a1b2c3d4e5f6g7h8')}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Created</label>
                  <p className="px-3 py-2 text-sm text-muted-foreground">January 15, 2024 at 10:30 AM</p>
                </div>
                <button className="btn-primary min-h-[44px]">Save Changes</button>
              </div>
            )}

            {/* Database */}
            {tab === 'database' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Connection String</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      /home/user/.pyrocore/project.db
                    </code>
                    <button
                      onClick={() => copyToClipboard('/home/user/.pyrocore/project.db')}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 border border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">WAL Mode</h3>
                    <p className="text-xs text-muted-foreground mt-1">Write-Ahead Logging improves concurrency and durability</p>
                  </div>
                  <button
                    onClick={() => setWalMode(!walMode)}
                    className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${walMode ? 'bg-success' : 'bg-muted'}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-foreground absolute top-0.5 transition-transform ${walMode ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Backup Interval</label>
                  <select
                    value={backupInterval}
                    onChange={(e) => setBackupInterval(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]"
                  >
                    <option value="15min">Every 15 minutes</option>
                    <option value="1hour">Every 1 hour</option>
                    <option value="6hours">Every 6 hours</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button className="px-4 py-2 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]">
                    Back Up Now
                  </button>
                  <button className="btn-primary min-h-[44px]">Save Changes</button>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Recent Backups</h3>
                  <div className="space-y-2">
                    {['2024-02-20 14:32', '2024-02-20 08:15', '2024-02-19 16:45'].map((backup) => (
                      <div key={backup} className="flex items-center justify-between px-3 py-2 border border-border text-sm min-h-[44px]">
                        <span className="font-mono text-muted-foreground">{backup}</span>
                        <button className="text-accent hover:underline text-sm min-h-[44px] flex items-center px-2">Restore</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* API */}
            {tab === 'api' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Base URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background border border-border text-sm font-mono text-muted-foreground truncate min-h-[44px] flex items-center">
                      https://api.pyrocore.local/projects/proj_a1b2
                    </code>
                    <button
                      onClick={() => copyToClipboard('https://api.pyrocore.local/projects/proj_a1b2')}
                      className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Rate Limit</label>
                  <select className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]">
                    <option>1000 requests / 1 hour</option>
                    <option>5000 requests / 1 hour</option>
                    <option>Unlimited</option>
                  </select>
                </div>
                <button className="btn-primary min-h-[44px]">Save Changes</button>
              </div>
            )}

            {/* Danger Zone */}
            {tab === 'danger' && (
              <div className="space-y-6 border-t-2 border-error pt-6">
                <div className="p-4 bg-error/10 border border-error">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-error flex-shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold text-error mb-1">Danger Zone</h3>
                      <p className="text-xs text-error/80">These actions are irreversible. Proceed with caution.</p>
                    </div>
                  </div>
                </div>

                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="px-4 py-2 bg-error/20 text-error text-sm font-medium hover:bg-error/30 transition-colors min-h-[44px]"
                  >
                    Delete Project
                  </button>
                ) : (
                  <div className="space-y-4 p-4 border border-error/30">
                    <p className="text-sm text-foreground">
                      To confirm, type the project name:{' '}
                      <span className="font-mono text-accent">{projectName}</span>
                    </p>
                    <input
                      type="text"
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      placeholder="Type project name..."
                      className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-error min-h-[44px]"
                    />
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => { setDeleteConfirm(false); setDeleteInput('') }}
                        className="flex-1 px-4 py-3 border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={deleteInput !== projectName}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors min-h-[44px] ${
                          deleteInput === projectName
                            ? 'bg-error text-error-foreground hover:bg-error/90'
                            : 'bg-muted text-muted-foreground cursor-not-allowed'
                        }`}
                      >
                        Delete Project
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
