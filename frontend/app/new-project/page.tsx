'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  HardDrive,
  Server,
  Lock,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'
import { CoreMark } from '@/components/brand'
import { PasswordStrength, getPasswordStrength } from '@/components/password-strength'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setStoredProject, selectProject } from '@/lib/api'

// ─── Password generator ─────────────────────────────────────────────────────
const UPPER  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER  = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMS   = '!@#$%^&*-_=+'
const ALL    = UPPER + LOWER + DIGITS + SYMS

function generatePassword(length = 20): string {
  // Guarantee at least one of each class
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMS)]
  const rest = Array.from({ length: length - 4 }, () => pick(ALL))
  return [...required, ...rest]
    .sort(() => Math.random() - 0.5)
    .join('')
}

// ─── Project-ID slugify ──────────────────────────────────────────────────────
function toProjectId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'my-project'
}

// ─── Step config ─────────────────────────────────────────────────────────────
const STEPS = [
  'Project details',
  'Database setup',
  'API & access',
  'Review & create',
] as const
type StepIndex = 0 | 1 | 2 | 3

// ─── Types ───────────────────────────────────────────────────────────────────
type StorageLocation = 'local' | 'remote'
type BackupInterval = '15min' | '1hour' | '6hours' | 'daily'

interface WizardState {
  // Step 1
  projectName: string
  projectId: string
  storageLocation: StorageLocation
  // Step 2
  backupInterval: BackupInterval
  adminPassword: string
  adminPasswordMode: 'generated' | 'custom'
  showAdminPassword: boolean
  // Step 3
  enablePublicApi: boolean
}

// The initial API key is issued by the server on project creation.
// We show a masked placeholder during the wizard so the user knows a key
// will be generated — the real value is displayed after the POST succeeds.
const API_KEY_PLACEHOLDER = 'pyro_live_••••••••••••••••••••'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ─── Main component ───────────────────────────────────────────────────────────
export default function NewProjectPage() {
  const router = useRouter()
  const [step, setStep] = useState<StepIndex>(0)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const [state, setState] = useState<WizardState>(() => ({
    projectName: '',
    projectId: 'my-project',
    storageLocation: 'local',
    backupInterval: '1hour',
    adminPassword: generatePassword(),
    adminPasswordMode: 'generated',
    showAdminPassword: false,
    enablePublicApi: true,
  }))

  // Keep projectId in sync with projectName
  useEffect(() => {
    setState((s) => ({ ...s, projectId: toProjectId(s.projectName) }))
  }, [state.projectName])

  const set = useCallback(<K extends keyof WizardState>(k: K, v: WizardState[K]) => {
    setState((s) => ({ ...s, [k]: v }))
  }, [])

  // ── Copy helper ──────────────────────────────────────────────────────────
  const copyText = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1800)
    } catch {
      // Fallback: could show a toast notification
    }
  }

  // ── Validation per step ─────────────────────────────────────────────────
  const canAdvance = (): boolean => {
    if (step === 0) return state.projectName.trim().length > 0
    if (step === 1) {
      if (state.adminPasswordMode === 'custom') {
        return getPasswordStrength(state.adminPassword) >= 2
      }
      return true
    }
    return true
  }

  // ── Final submit ─────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          project_id: state.projectId,
          project_name: state.projectName,
          storage_location: state.storageLocation,
          backup_interval: state.backupInterval,
          admin_password: state.adminPassword,
          enable_public_api: state.enablePublicApi,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setCreateError(body?.message ?? `Server error (${res.status}). Please try again.`)
        return
      }
      // Select the newly created project so its data shows immediately, and
      // persist it server-side as the active project.
      const created = await res.json().catch(() => ({} as any))
      const newId = created?.id ?? state.projectId
      if (newId) {
        setStoredProject({ id: newId, name: state.projectName || newId })
        void selectProject(newId)
      }
      router.push('/')
    } catch {
      setCreateError('Could not reach the server. Check your connection and try again.')
    } finally {
      setCreating(false)
    }
  }

  // ── Step header ──────────────────────────────────────────────────────────
  const progressPct = ((step + 1) / STEPS.length) * 100

  return (
    <AuthShell variant="panel" width="md">
      <div className="flex flex-col">
        {/* ── HEADER / PROGRESS ─────────────────────────────────────── */}
        <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-seam">
          <div className="flex items-baseline justify-between mb-5 gap-4">
            <span className="flex items-center gap-2.5">
              <CoreMark size={20} />
              <span className="wordmark text-[14px] text-ink">PyroCore</span>
            </span>
            <span className="data text-[11px] text-ink-faint">
              Step {step + 1} of {STEPS.length} / {STEPS[step]}
            </span>
          </div>
          {/* Progress: a hairline that fills with heat. */}
          <div className="h-px w-full bg-seam overflow-hidden">
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>
        </div>

        {/* ── STEP CONTENT ──────────────────────────────────────────── */}
        <div className="px-6 sm:px-8 py-7 space-y-6 flex-1">

          {/* ════ STEP 1 — Project details ════ */}
          {step === 0 && (
            <>
              <div>
                <h2 className="display text-[22px]">Project details</h2>
                <p className="text-[13px] text-ink-muted mt-2">
                  Give the project a name and choose where its data lives.
                </p>
              </div>

              {/* Project name */}
              <div className="space-y-1.5">
                <label htmlFor="project-name" className="block text-[13px] font-medium text-ink">
                  Project name
                </label>
                <Input
                  id="project-name"
                  type="text"
                  value={state.projectName}
                  onChange={(e) => set('projectName', e.target.value)}
                  placeholder="my-project"
                  autoFocus
                  className="h-11"
                />
              </div>

              {/* Project ID — read-only, derived */}
              <div className="space-y-1.5">
                <label htmlFor="project-id" className="block text-[13px] font-medium text-ink">
                  Project id
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-plate-raised border border-seam min-h-[44px]">
                  <code id="project-id" className="flex-1 data text-[12px] text-ink-muted truncate">
                    {state.projectId}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyText(state.projectId, 'projectId')}
                    className="p-1.5 text-ink-muted hover:text-ink transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    aria-label="Copy project id"
                  >
                    {copiedField === 'projectId' ? (
                      <Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p className="data text-[11px] text-ink-faint">
                  Used in your API URL. It cannot be changed after creation.
                </p>
              </div>

              {/* Storage location */}
              <div className="space-y-2">
                <p className="block text-[13px] font-medium text-ink">Storage location</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    {
                      value: 'local' as const,
                      icon: HardDrive,
                      label: 'Local',
                      sub: 'Runs on this machine, zero cost',
                    },
                    {
                      value: 'remote' as const,
                      icon: Server,
                      label: 'Remote host',
                      sub: 'Deploy to a VM or free tier host, changeable later',
                    },
                  ]).map(({ value, icon: Icon, label, sub }) => {
                    const active = state.storageLocation === value
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set('storageLocation', value)}
                        aria-pressed={active}
                        className={[
                          'seam-open flex items-start gap-3 p-4 border text-left transition-colors border-l-2',
                          active
                            ? 'bg-plate-raised text-ink'
                            : 'bg-plate text-ink-muted hover:bg-plate-raised',
                        ].join(' ')}
                        style={{
                          borderColor: active ? 'var(--accent)' : 'var(--seam)',
                          borderLeftColor: active ? 'var(--accent)' : 'var(--seam)',
                        }}
                      >
                        <Icon
                          className="w-4 h-4 mt-0.5 flex-shrink-0"
                          style={{ color: active ? 'var(--accent)' : 'var(--ink-faint)' }}
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-[13px] font-medium">{label}</p>
                          <p className="text-[12px] mt-0.5 text-ink-faint">{sub}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* ════ STEP 2 — Database setup ════ */}
          {step === 1 && (
            <>
              <div>
                <h2 className="display text-[22px]">Database setup</h2>
                <p className="text-[13px] text-ink-muted mt-2">
                  PyroCore runs SQLite in WAL mode for safe concurrent access. There is nothing to
                  configure.
                </p>
              </div>

              {/* WAL mode — locked on, read-only */}
              <div className="flex items-center justify-between p-4 border border-seam bg-plate">
                <div className="flex items-center gap-2.5">
                  <Lock className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[13px] font-medium text-ink">WAL mode</p>
                    <p className="text-[12px] text-ink-muted mt-0.5">
                      Write-Ahead Logging, enabled by default
                    </p>
                  </div>
                </div>
                <span
                  className="data text-[11px] text-success border border-success/40 bg-success/10 px-2 py-1 flex-shrink-0"
                  aria-label="WAL mode is always enabled"
                >
                  Enabled
                </span>
              </div>

              {/* Backup interval */}
              <div className="space-y-1.5">
                <label htmlFor="backup-interval" className="block text-[13px] font-medium text-ink">
                  Backup interval
                </label>
                <Select
                  value={state.backupInterval}
                  onValueChange={(v) => set('backupInterval', v as BackupInterval)}
                >
                  <SelectTrigger id="backup-interval" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15min">Every 15 minutes</SelectItem>
                    <SelectItem value="1hour">Every 1 hour</SelectItem>
                    <SelectItem value="6hours">Every 6 hours</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Admin password */}
              <div className="space-y-1.5">
                <div>
                  <label htmlFor="admin-password" className="block text-[13px] font-medium text-ink">
                    Admin password
                  </label>
                  <p className="text-[12px] text-ink-muted mt-0.5">
                    Used to reach this project&apos;s dashboard and admin API. Store it somewhere
                    safe, it is not shown again.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Password input */}
                  <div className="relative flex-1">
                    <Input
                      id="admin-password"
                      type={state.showAdminPassword ? 'text' : 'password'}
                      value={state.adminPassword}
                      readOnly={state.adminPasswordMode === 'generated'}
                      onChange={(e) =>
                        state.adminPasswordMode === 'custom' &&
                        set('adminPassword', e.target.value)
                      }
                      aria-label="Admin password"
                      className={[
                        'data pr-11 h-11',
                        state.adminPasswordMode === 'generated' ? 'text-ink-faint' : '',
                      ].join(' ')}
                    />
                    {/* Show/hide toggle inside field */}
                    <button
                      type="button"
                      onClick={() => set('showAdminPassword', !state.showAdminPassword)}
                      className="absolute right-0 top-0 bottom-0 px-3 text-ink-muted hover:text-ink transition-colors flex items-center justify-center min-w-[44px]"
                      aria-label={state.showAdminPassword ? 'Hide password' : 'Show password'}
                    >
                      {state.showAdminPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {/* Regenerate — only in generated mode */}
                  {state.adminPasswordMode === 'generated' && (
                    <button
                      type="button"
                      onClick={() => set('adminPassword', generatePassword())}
                      className="p-2 border border-seam text-ink-muted hover:text-ink hover:bg-plate-raised transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label="Regenerate password"
                      title="Regenerate"
                    >
                      <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}

                  {/* Copy */}
                  <button
                    type="button"
                    onClick={() => copyText(state.adminPassword, 'adminPw')}
                    className="p-2 border border-seam text-ink-muted hover:text-ink hover:bg-plate-raised transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center relative"
                    aria-label="Copy password"
                    title={copiedField === 'adminPw' ? 'Copied' : 'Copy'}
                  >
                    {copiedField === 'adminPw' ? (
                      <Check className="w-4 h-4 text-success" aria-hidden="true" />
                    ) : (
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Strength meter — shown in custom mode */}
                {state.adminPasswordMode === 'custom' && (
                  <PasswordStrength password={state.adminPassword} />
                )}

                {/* Toggle between generated / custom */}
                {state.adminPasswordMode === 'generated' ? (
                  <button
                    type="button"
                    onClick={() => {
                      set('adminPasswordMode', 'custom')
                      set('adminPassword', '')
                    }}
                    className="link text-[12.5px] mt-1 inline-block"
                  >
                    Set my own password instead
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      set('adminPasswordMode', 'generated')
                      set('adminPassword', generatePassword())
                    }}
                    className="link text-[12.5px] mt-1 inline-block"
                  >
                    Use a generated password instead
                  </button>
                )}
              </div>
            </>
          )}

          {/* ════ STEP 3 — API & access ════ */}
          {step === 2 && (
            <>
              <div>
                <h2 className="display text-[22px]">API and access</h2>
                <p className="text-[13px] text-ink-muted mt-2">
                  An initial API key is generated when the project is created.
                </p>
              </div>

              {/* Initial API key — shown as placeholder until project is created */}
              <div className="space-y-1.5">
                <p className="block text-[13px] font-medium text-ink">Initial API key</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 bg-plate-raised border border-seam p-3 min-h-[44px]">
                    <code className="flex-1 data text-[12px] text-ink-faint truncate">
                      {API_KEY_PLACEHOLDER}
                    </code>
                  </div>
                  {/* Key metadata row */}
                  <div className="flex items-center gap-3 px-1">
                    <span className="data text-[11px] text-ink-faint">
                      Name <span className="text-ink">default</span>
                    </span>
                    <span className="data text-[11px] text-ink-faint">
                      Scopes <span className="text-ink">Read + Write</span>
                    </span>
                  </div>
                </div>
                <p className="text-[12px] text-ink-muted">
                  The full key is shown once after creation. You can create more keys with different
                  scopes from the dashboard at any time.
                </p>
              </div>

              {/* Enable public REST API toggle */}
              <div className="flex items-center justify-between gap-4 p-4 border border-seam">
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-ink">Enable the public REST API</p>
                  <p className="text-[12px] text-ink-muted mt-0.5">
                    Lets your app query this project over HTTP with the key above.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => set('enablePublicApi', !state.enablePublicApi)}
                  role="switch"
                  aria-checked={state.enablePublicApi}
                  aria-label="Enable the public REST API"
                  className={[
                    'w-12 h-7 border flex-shrink-0 relative transition-colors',
                    state.enablePublicApi
                      ? 'border-accent bg-accent/20'
                      : 'border-seam bg-plate-raised',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-[3px] w-4 h-4 transition-all',
                      state.enablePublicApi ? 'left-[22px] bg-accent' : 'left-[3px] bg-ink-faint',
                    ].join(' ')}
                  />
                </button>
              </div>
            </>
          )}

          {/* ════ STEP 4 — Review & create ════ */}
          {step === 3 && (
            <>
              <div>
                <h2 className="display text-[22px]">Review and create</h2>
                <p className="text-[13px] text-ink-muted mt-2">
                  Check the details, then create the project.
                </p>
              </div>

              {/* Summary table — label/value pairs */}
              <dl className="border border-seam divide-y divide-seam">
                {[
                  { label: 'Project name', value: state.projectName || 'Not set', mono: false },
                  { label: 'Project id', value: state.projectId, mono: true },
                  {
                    label: 'Storage',
                    value: state.storageLocation === 'local' ? 'Local, this machine' : 'Remote host',
                    mono: false,
                  },
                  {
                    label: 'Backup interval',
                    value: {
                      '15min': 'Every 15 minutes',
                      '1hour': 'Every 1 hour',
                      '6hours': 'Every 6 hours',
                      'daily': 'Daily',
                    }[state.backupInterval],
                    mono: false,
                  },
                  {
                    label: 'API access',
                    value: state.enablePublicApi ? 'Public REST API enabled' : 'Public REST API disabled',
                    mono: false,
                  },
                  {
                    label: 'API key',
                    value: 'Generated on creation',
                    mono: false,
                  },
                ].map(({ label, value, mono }) => (
                  <div key={label} className="flex items-baseline gap-4 px-4 py-3">
                    <dt className="label w-32 flex-shrink-0">{label}</dt>
                    <dd className={`text-[13px] flex-1 text-ink ${mono ? 'data text-[12px]' : ''}`}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        {/* ── FOOTER — Back / Next / Create ─────────────────────────── */}
        <div className="px-6 sm:px-8 py-5 border-t border-seam flex flex-col gap-3">
          {/* Server error from the create call */}
          {createError && (
            <p role="alert" className="text-[13px] text-center text-error">
              {createError}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            {/* Back — invisible on step 0 to preserve the layout */}
            <Button
              variant="outline"
              size="lg"
              onClick={() => setStep((s) => (s - 1) as StepIndex)}
              disabled={step === 0}
              className={step === 0 ? 'invisible' : ''}
            >
              Back
            </Button>

            {/* Next / Create */}
            {step < 3 ? (
              <Button
                size="lg"
                onClick={() => setStep((s) => (s + 1) as StepIndex)}
                disabled={!canAdvance()}
              >
                Next
              </Button>
            ) : (
              <Button size="lg" onClick={handleCreate} disabled={creating}>
                {creating ? 'Creating project' : 'Create project'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </AuthShell>
  )
}
