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
import { PasswordStrength, getPasswordStrength } from '@/components/password-strength'

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
  // Derived — generated once
  initialApiKey: string
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function NewProjectPage() {
  const router = useRouter()
  const [step, setStep] = useState<StepIndex>(0)
  const [creating, setCreating] = useState(false)
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
    initialApiKey: `pyro_live_${Math.random().toString(36).slice(2, 20)}`,
  }))

  // Keep projectId in sync with projectName
  useEffect(() => {
    setState((s) => ({ ...s, projectId: toProjectId(s.projectName) }))
  }, [state.projectName])

  const set = useCallback(<K extends keyof WizardState>(k: K, v: WizardState[K]) => {
    setState((s) => ({ ...s, [k]: v }))
  }, [])

  // ── Copy helper ──────────────────────────────────────────────────────────
  const copyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 1800)
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
    // SQLite file creation is near-instant; minimal simulated round-trip
    await new Promise((r) => setTimeout(r, 500))
    router.push('/')
  }

  // ── Step header ──────────────────────────────────────────────────────────
  const progressPct = ((step + 1) / STEPS.length) * 100

  return (
    <AuthShell width="md">
      <div className="flex flex-col">
        {/* ── HEADER / PROGRESS ─────────────────────────────────────── */}
        <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-border">
          <div className="flex items-baseline justify-between mb-4">
            <h1 className="text-base font-semibold text-foreground">PyroCore</h1>
            <span className="text-xs text-muted-foreground">
              Step {step + 1} of {STEPS.length} — {STEPS[step]}
            </span>
          </div>
          {/* Progress bar — 4px track, pyro-orange fill */}
          <div className="h-1 w-full bg-border overflow-hidden">
            <div
              className="h-full transition-all duration-300 ease-out"
              style={{
                width: `${progressPct}%`,
                backgroundColor: 'var(--pyro-orange)',
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
                <h2 className="text-lg font-semibold text-foreground mb-1">Project details</h2>
                <p className="text-sm text-muted-foreground">
                  Give your project a name and choose where its data lives.
                </p>
              </div>

              {/* Project name */}
              <div className="space-y-1.5">
                <label htmlFor="project-name" className="block text-sm font-medium text-foreground">
                  Project name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={state.projectName}
                  onChange={(e) => set('projectName', e.target.value)}
                  placeholder="my-project"
                  autoFocus
                  className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-accent min-h-[44px]"
                />
              </div>

              {/* Project ID — read-only, derived */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Project ID
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border min-h-[44px]">
                  <code className="flex-1 text-sm font-mono text-muted-foreground truncate">
                    {state.projectId}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyText(state.projectId, 'projectId')}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    aria-label="Copy project ID"
                  >
                    {copiedField === 'projectId'
                      ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                      : <Copy className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Used in your API URL. Can&apos;t be changed after creation.
                </p>
              </div>

              {/* Storage location */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Storage location
                </label>
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
                      sub: 'Deploy to a VM or free-tier host — changeable later',
                    },
                  ]).map(({ value, icon: Icon, label, sub }) => {
                    const active = state.storageLocation === value
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set('storageLocation', value)}
                        className={[
                          'flex items-start gap-3 p-4 border text-left transition-colors',
                          'border-l-4',
                          active
                            ? 'bg-muted/30'
                            : 'bg-background hover:bg-muted/20',
                        ].join(' ')}
                        style={{
                          borderColor: active ? 'var(--pyro-orange)' : 'var(--border)',
                          borderLeftColor: active ? 'var(--pyro-orange)' : 'var(--border)',
                        }}
                      >
                        <Icon
                          className="w-4 h-4 mt-0.5 flex-shrink-0"
                          style={{ color: active ? 'var(--pyro-orange)' : 'var(--muted-foreground)' }}
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                            {sub}
                          </p>
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
                <h2 className="text-lg font-semibold text-foreground mb-1">Database setup</h2>
                <p className="text-sm text-muted-foreground">
                  PyroCore uses SQLite with WAL mode for safe concurrent access — no configuration needed.
                </p>
              </div>

              {/* WAL mode — locked on, read-only */}
              <div className="flex items-center justify-between p-4 border border-border bg-muted/10">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">WAL mode</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Write-Ahead Logging — enabled by default
                    </p>
                  </div>
                </div>
                {/* Locked toggle — visually on, not interactive */}
                <div
                  className="w-11 h-6 rounded-full relative flex-shrink-0 opacity-60"
                  style={{ backgroundColor: 'var(--success)' }}
                  aria-label="WAL mode enabled"
                >
                  <div className="w-5 h-5 rounded-full bg-foreground absolute top-0.5 translate-x-5" />
                </div>
              </div>

              {/* Backup interval */}
              <div className="space-y-1.5">
                <label htmlFor="backup-interval" className="block text-sm font-medium text-foreground">
                  Backup interval
                </label>
                <select
                  id="backup-interval"
                  value={state.backupInterval}
                  onChange={(e) => set('backupInterval', e.target.value as BackupInterval)}
                  className="w-full px-3 py-2 bg-background border border-border text-sm text-foreground focus:outline-none focus:border-accent min-h-[44px]"
                >
                  <option value="15min">Every 15 minutes</option>
                  <option value="1hour">Every 1 hour</option>
                  <option value="6hours">Every 6 hours</option>
                  <option value="daily">Daily</option>
                </select>
              </div>

              {/* Admin password */}
              <div className="space-y-1.5">
                <div>
                  <label htmlFor="admin-password" className="block text-sm font-medium text-foreground">
                    Admin password
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Used to access this project&apos;s dashboard and admin API.
                    Store this somewhere safe — it won&apos;t be shown again.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Password input */}
                  <div className="relative flex-1">
                    <input
                      id="admin-password"
                      type={state.showAdminPassword ? 'text' : 'password'}
                      value={state.adminPassword}
                      readOnly={state.adminPasswordMode === 'generated'}
                      onChange={(e) =>
                        state.adminPasswordMode === 'custom' &&
                        set('adminPassword', e.target.value)
                      }
                      className={[
                        'w-full pl-3 pr-10 py-2 border text-sm font-mono focus:outline-none min-h-[44px]',
                        state.adminPasswordMode === 'generated'
                          ? 'bg-muted/20 border-border text-foreground cursor-default'
                          : 'bg-background border-border text-foreground focus:border-accent',
                      ].join(' ')}
                      aria-label="Admin password"
                    />
                    {/* Show/hide toggle inside field */}
                    <button
                      type="button"
                      onClick={() => set('showAdminPassword', !state.showAdminPassword)}
                      className="absolute right-0 top-0 bottom-0 px-3 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center min-w-[44px]"
                      aria-label={state.showAdminPassword ? 'Hide password' : 'Show password'}
                    >
                      {state.showAdminPassword
                        ? <EyeOff className="w-4 h-4" />
                        : <Eye className="w-4 h-4" />
                      }
                    </button>
                  </div>

                  {/* Regenerate — only in generated mode */}
                  {state.adminPasswordMode === 'generated' && (
                    <button
                      type="button"
                      onClick={() => set('adminPassword', generatePassword())}
                      className="p-2 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label="Regenerate password"
                      title="Regenerate"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}

                  {/* Copy */}
                  <button
                    type="button"
                    onClick={() => copyText(state.adminPassword, 'adminPw')}
                    className="p-2 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center relative"
                    aria-label="Copy password"
                    title={copiedField === 'adminPw' ? 'Copied!' : 'Copy'}
                  >
                    {copiedField === 'adminPw'
                      ? <Check className="w-4 h-4" style={{ color: 'var(--success)' }} />
                      : <Copy className="w-4 h-4" />
                    }
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
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 mt-1"
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
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 mt-1"
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
                <h2 className="text-lg font-semibold text-foreground mb-1">API & access</h2>
                <p className="text-sm text-muted-foreground">
                  An initial API key has been generated for your project.
                </p>
              </div>

              {/* Initial API key — masked + copy, same pattern as API Keys page */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Initial API key
                </label>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 bg-background border border-border p-3 min-h-[44px]">
                    <code className="flex-1 text-sm font-mono text-foreground truncate">
                      {state.initialApiKey.slice(0, 12)}••••••••••••
                    </code>
                    <button
                      type="button"
                      onClick={() => copyText(state.initialApiKey, 'apiKey')}
                      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                      aria-label="Copy API key"
                    >
                      {copiedField === 'apiKey'
                        ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                        : <Copy className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                  {/* Key metadata row */}
                  <div className="flex items-center gap-3 px-1">
                    <span className="text-xs text-muted-foreground">Name: <span className="font-mono text-foreground">default</span></span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">Scopes: <span className="text-foreground">Read + Write</span></span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  You can create more keys with different scopes anytime from the dashboard.
                </p>
              </div>

              {/* Enable public REST API toggle */}
              <div className="flex items-center justify-between p-4 border border-border">
                <div className="flex-1 pr-4">
                  <p className="text-sm font-medium text-foreground">Enable public REST API</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Lets your app query this project over HTTP using the API key above.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => set('enablePublicApi', !state.enablePublicApi)}
                  className={[
                    'w-11 h-6 rounded-full transition-colors relative flex-shrink-0',
                    state.enablePublicApi ? '' : 'bg-muted',
                  ].join(' ')}
                  style={state.enablePublicApi ? { backgroundColor: 'var(--success)' } : {}}
                  role="switch"
                  aria-checked={state.enablePublicApi}
                  aria-label="Enable public REST API"
                >
                  <div
                    className={[
                      'w-5 h-5 rounded-full bg-foreground absolute top-0.5 transition-transform',
                      state.enablePublicApi ? 'translate-x-5' : 'translate-x-0.5',
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
                <h2 className="text-lg font-semibold text-foreground mb-1">Review & create</h2>
                <p className="text-sm text-muted-foreground">
                  Everything looks good? Create your project.
                </p>
              </div>

              {/* Summary table — label/value pairs */}
              <div className="border border-border divide-y divide-border">
                {[
                  { label: 'Project name', value: state.projectName || '—', mono: false },
                  { label: 'Project ID',   value: state.projectId,          mono: true  },
                  {
                    label: 'Storage',
                    value: state.storageLocation === 'local' ? 'Local (this machine)' : 'Remote host',
                    mono: false,
                  },
                  {
                    label: 'Backup interval',
                    value: {
                      '15min':  'Every 15 minutes',
                      '1hour':  'Every 1 hour',
                      '6hours': 'Every 6 hours',
                      'daily':  'Daily',
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
                    value: `${state.initialApiKey.slice(0, 12)}••••`,
                    mono: true,
                  },
                ].map(({ label, value, mono }) => (
                  <div key={label} className="flex items-baseline gap-4 px-4 py-3">
                    <span className="text-xs text-muted-foreground w-32 flex-shrink-0">{label}</span>
                    <span className={`text-sm flex-1 text-foreground ${mono ? 'font-mono' : ''}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── FOOTER — Back / Next / Create ─────────────────────────── */}
        <div className="px-6 sm:px-8 py-5 border-t border-border flex items-center justify-between gap-3">
          {/* Back — ghost style, invisible on step 0 to preserve layout */}
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as StepIndex)}
            disabled={step === 0}
            className={[
              'px-4 py-2 text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors min-h-[44px]',
              step === 0 ? 'invisible' : '',
            ].join(' ')}
          >
            Back
          </button>

          {/* Next / Create */}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as StepIndex)}
              disabled={!canAdvance()}
              className="btn-primary min-h-[44px] px-6 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="btn-primary min-h-[44px] px-6 flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {creating ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                  Creating project…
                </>
              ) : (
                'Create project'
              )}
            </button>
          )}
        </div>
      </div>
    </AuthShell>
  )
}
