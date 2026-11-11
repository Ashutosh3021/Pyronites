'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { PageHeader } from '@/components/page-header'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Copy, Check, Key, Terminal, RefreshCw } from 'lucide-react'
import {
  API_BASE,
  getStoredProjectId,
  getStoredProjectName,
  PROJECT_CHANGE_EVENT,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { AlertBanner } from '@/components/alert-banner'

interface ConnectPrompt {
  prompt: string
  backend_url: string
  email: string | null
  project_id: string
  project_slug: string
  project_name: string
}

const KEY_LINE = 'PYRONITES_API_KEY='

export default function ConnectPage() {
  const [data, setData] = useState<ConnectPrompt | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyNotice, setKeyNotice] = useState<string | null>(null)
  const [projectLabel, setProjectLabel] = useState<string | null>(null)

  const load = useCallback(async () => {
    const projectId = getStoredProjectId()
    setProjectLabel(getStoredProjectName())
    if (!projectId) {
      setData(null)
      setLoadError('No project selected. Pick a project from the rail first.')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/connect-prompt` +
          `?base_url=${encodeURIComponent(API_BASE)}`,
        { credentials: 'include' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? `Could not load the connection prompt (${res.status}).`)
      }
      setData((await res.json()) as ConnectPrompt)
    } catch (e) {
      setData(null)
      setLoadError(e instanceof Error ? e.message : 'Could not load the connection prompt.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const onChange = () => {
      setApiKey('')
      load()
    }
    window.addEventListener(PROJECT_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(PROJECT_CHANGE_EVENT, onChange)
  }, [load])

  /**
   * The prompt the backend renders always carries an empty API key field.
   * The user fills it in here (or generates one), and the field is filled in
   * here before the prompt is copied.
   */
  const prompt = useMemo(() => {
    if (!data) return ''
    const lines = data.prompt.split('\n')
    return lines
      .map((line) => (line.startsWith(KEY_LINE) ? `${KEY_LINE}${apiKey.trim()}` : line))
      .join('\n')
  }, [data, apiKey])

  const copyPrompt = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setKeyError('Could not copy to the clipboard. Select the text and copy it manually.')
    }
  }

  const generateKey = async () => {
    const projectId = getStoredProjectId()
    if (!projectId) {
      setKeyError('No project selected.')
      return
    }
    setGenerating(true)
    setKeyError(null)
    setKeyNotice(null)
    try {
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/api/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: 'connect-prompt',
          scopes: ['read', 'write', 'admin'],
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? `Could not create a key (${res.status}).`)
      }
      const body = await res.json()
      setApiKey(body.key)
      setKeyNotice('Key created. It is shown once — the prompt now carries it.')
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : 'Could not create a key.')
    } finally {
      setGenerating(false)
    }
  }

  const details: Array<{ label: string; value: string }> = data
    ? [
        { label: 'Backend URL', value: data.backend_url || API_BASE },
        { label: 'Account email', value: data.email ?? '—' },
        { label: 'Project', value: `${data.project_name} (${data.project_slug})` },
        { label: 'Project id', value: data.project_id },
      ]
    : []

  return (
    <PyroCoreLayout>
      <PageHeader
        meta="Wiring"
        title="Connect your app"
        description={`Copy the prompt below and paste it into your coding agent. It carries the credentials for ${projectLabel ?? 'this project'} and the steps to wire, test and verify the connection.`}
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Connection details */}
        <Card>
          <CardContent className="p-5 lg:p-6 space-y-5">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Connection details</h2>
              <p className="text-[12.5px] text-ink-muted mt-1">
                These values are project-scoped. A key made for this project cannot reach another
                project&rsquo;s data.
              </p>
            </div>

            {loadError && (
              <AlertBanner variant="error" message={loadError} onDismiss={() => setLoadError(null)} />
            )}

            <dl className="space-y-3">
              {details.map((d) => (
                <div key={d.label} className="space-y-1.5">
                  <dt className="label">{d.label}</dt>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-plate-raised border border-seam data text-[12px] text-ink-muted truncate min-h-[44px] flex items-center">
                      {d.value}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigator.clipboard?.writeText(d.value)}
                      aria-label={`Copy ${d.label}`}
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </dl>

            <div className="space-y-2">
              <label htmlFor="api-key" className="block text-[13px] font-medium text-ink">
                API key
              </label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="pyro_live_…"
                autoComplete="off"
                spellCheck={false}
                className="data text-[12px]"
              />
              <p className="text-[12px] text-ink-muted">
                Paste a key you already have, or generate one for this project. It is written into
                the prompt below as <span className="data">PYRONITES_API_KEY</span>.
              </p>
              {keyError && (
                <AlertBanner variant="error" message={keyError} onDismiss={() => setKeyError(null)} />
              )}
              {keyNotice && (
                <AlertBanner
                  variant="success"
                  message={keyNotice}
                  onDismiss={() => setKeyNotice(null)}
                />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={generateKey} disabled={generating}>
                  <Key className="w-4 h-4" aria-hidden="true" />
                  {generating ? 'Generating' : 'Generate key'}
                </Button>
                {apiKey && (
                  <Button variant="ghost" size="sm" onClick={() => setApiKey('')}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Prompt */}
        <Card>
          <CardContent className="p-5 lg:p-6 space-y-5">
            <div>
              <h2 className="text-[15px] font-semibold text-ink flex items-center gap-2">
                <Terminal className="w-4 h-4" aria-hidden="true" />
                Connection prompt
              </h2>
              <p className="text-[12.5px] text-ink-muted mt-1">
                Paste this into your coding agent. It tells the agent exactly which project to
                target, what to install, how to wire the client, and how to verify the result.
              </p>
            </div>

            <textarea
              readOnly
              value={prompt}
              aria-label="Connection prompt"
              rows={22}
              spellCheck={false}
              className="w-full border border-seam bg-plate-raised px-3 py-2 data text-[12px] leading-relaxed text-ink-muted resize-y focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={copyPrompt} disabled={!prompt}>
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-success" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    Copy prompt
                  </>
                )}
              </Button>
              {!apiKey && (
                <span className="text-[12px] text-ink-faint">
                  The API key field is empty — fill it in before you copy.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PyroCoreLayout>
  )
}
