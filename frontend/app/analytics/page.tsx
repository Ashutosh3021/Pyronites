'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { useRef, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Download, Check } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────
type Range = '24h' | '7d' | '30d'

// ─── Sparkline — pure SVG, no chart library dependency ───────────────────────
// Renders a 60×24 polyline from an array of 0–1 normalised values.
function Sparkline({
  data,
  color = 'var(--pyro-orange)',
  filled = false,
}: {
  data: number[]
  color?: string
  filled?: boolean
}) {
  const W = 120, H = 32
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - v * (H - 4) - 2
    return `${x},${y}`
  })
  const polyline = pts.join(' ')
  const area = filled
    ? `M0,${H} L${pts[0]} L${pts.slice(1).join(' L')} L${W},${H} Z`
    : ''

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-8"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {filled && (
        <path d={area} fill={color} fillOpacity="0.12" stroke="none" />
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ─── Bar chart — SVG, no library ─────────────────────────────────────────────
function BarChart({
  data,
  labels,
  color = 'var(--pyro-orange)',
}: {
  data: number[]
  labels: string[]
  color?: string
}) {
  const max = Math.max(...data, 1)
  const W = 400, H = 80, gap = 4
  const barW = (W - gap * (data.length - 1)) / data.length

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: '80px' }}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {data.map((v, i) => {
        const barH = (v / max) * (H - 16)
        const x = i * (barW + gap)
        const y = H - barH - 14
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            fill={color}
            fillOpacity={i === data.length - 1 ? '0.4' : '0.75'}
          />
        )
      })}
    </svg>
  )
}

// ─── Stat card with sparkline ─────────────────────────────────────────────────
type Trend = 'up' | 'down' | 'flat'
function StatCard({
  label,
  value,
  subtext,
  trend,
  trendLabel,
  sparkData,
  sparkColor,
}: {
  label: string
  value: string
  subtext?: string
  trend: Trend
  trendLabel: string
  sparkData: number[]
  sparkColor?: string
}) {
  const trendColor =
    trend === 'up'   ? 'var(--success)'
    : trend === 'down' ? 'var(--error)'
    : 'var(--muted-foreground)'
  const TrendIcon =
    trend === 'up' ? TrendingUp
    : trend === 'down' ? TrendingDown
    : Minus

  return (
    <div className="bg-card border border-border p-4 lg:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <TrendIcon className="w-3 h-3" style={{ color: trendColor }} />
          <span className="text-xs font-medium" style={{ color: trendColor }}>
            {trendLabel}
          </span>
        </div>
      </div>
      <div>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
      </div>
      <Sparkline data={sparkData} color={sparkColor ?? 'var(--pyro-orange)'} filled />
    </div>
  )
}

// ─── Dataset fixtures ─────────────────────────────────────────────────────────
// Normalised 0–1 values for sparklines (24 data points = 24h/7d/30d buckets)
const SPARK: Record<Range, {
  requests: number[]
  latency: number[]
  errors: number[]
  dbReads: number[]
  dbWrites: number[]
  storage: number[]
}> = {
  '24h': {
    requests: [.3,.35,.4,.38,.5,.6,.72,.65,.7,.8,.75,.9,1,.88,.82,.79,.7,.68,.6,.55,.5,.45,.4,.38],
    latency:  [.4,.42,.38,.45,.5,.48,.52,.6,.55,.5,.48,.46,.44,.5,.55,.52,.48,.45,.42,.44,.46,.48,.45,.43],
    errors:   [.1,.05,.08,.12,.15,.1,.08,.05,.12,.18,.15,.1,.08,.12,.2,.15,.1,.08,.05,.1,.12,.08,.06,.05],
    dbReads:  [.3,.4,.5,.55,.6,.7,.8,.75,.85,.9,.95,1,.9,.85,.8,.75,.7,.65,.6,.55,.5,.45,.4,.35],
    dbWrites: [.2,.25,.3,.28,.35,.4,.45,.42,.5,.55,.52,.6,.58,.55,.5,.48,.45,.42,.4,.38,.35,.3,.28,.25],
    storage:  [.5,.51,.51,.52,.52,.53,.53,.54,.54,.55,.55,.56,.56,.57,.57,.58,.58,.59,.59,.6,.6,.61,.61,.62],
  },
  '7d': {
    requests: [.4,.55,.6,.72,.65,.85,1],
    latency:  [.45,.5,.48,.55,.52,.5,.47],
    errors:   [.15,.12,.18,.1,.08,.12,.07],
    dbReads:  [.45,.6,.7,.8,.75,.9,1],
    dbWrites: [.3,.4,.45,.5,.48,.55,.6],
    storage:  [.5,.52,.54,.56,.57,.59,.62],
  },
  '30d': {
    requests: [.2,.3,.25,.35,.4,.38,.45,.5,.48,.55,.6,.58,.65,.7,.68,.75,.8,.78,.85,.9,.88,.92,.95,.98,.9,.85,.88,.92,.96,1],
    latency:  [.5,.48,.52,.5,.47,.49,.51,.5,.48,.46,.5,.52,.48,.45,.47,.5,.52,.49,.48,.5,.47,.45,.48,.5,.47,.45,.47,.49,.5,.48],
    errors:   [.2,.18,.15,.12,.18,.15,.12,.1,.15,.18,.12,.1,.08,.12,.15,.1,.08,.12,.15,.1,.08,.06,.1,.12,.08,.06,.04,.08,.1,.07],
    dbReads:  [.3,.35,.4,.45,.5,.55,.6,.58,.65,.7,.68,.75,.8,.78,.82,.85,.88,.9,.92,.95,.9,.88,.9,.92,.95,.98,1,.97,.95,.93],
    dbWrites: [.2,.25,.28,.32,.35,.38,.42,.45,.48,.5,.52,.55,.58,.6,.62,.65,.68,.7,.72,.75,.72,.7,.72,.75,.78,.8,.82,.85,.88,.9],
    storage:  [.4,.41,.42,.43,.44,.45,.46,.46,.47,.48,.49,.5,.51,.52,.52,.53,.54,.55,.56,.57,.57,.58,.59,.6,.6,.61,.62,.62,.63,.64],
  },
}

const BARS: Record<Range, { requests: number[]; labels: string[] }> = {
  '24h': {
    requests: [120,145,130,160,190,210,240,220,195,230,215,200,185,170,155,180,165,140,130,120,110,105,95,88],
    labels: ['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
  },
  '7d': {
    requests: [820,950,1100,1247,1050,1180,1320],
    labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  },
  '30d': {
    requests: [600,650,700,720,680,750,800,850,820,900,950,920,980,1020,1000,1050,1100,1080,1150,1200,1180,1240,1280,1300,1260,1320,1380,1400,1350,1420],
    labels: Array.from({ length: 30 }, (_, i) => `${i + 1}`),
  },
}

// Top endpoints table data
const TOP_ENDPOINTS = [
  { method: 'GET',    path: '/api/users',           count: 412, p50: 18, p95: 64, errors: 2 },
  { method: 'GET',    path: '/api/posts',            count: 308, p50: 22, p95: 81, errors: 0 },
  { method: 'POST',   path: '/api/sessions',         count: 201, p50: 31, p95: 95, errors: 5 },
  { method: 'GET',    path: '/api/users/:id',        count: 185, p50: 14, p95: 48, errors: 1 },
  { method: 'DELETE', path: '/api/sessions/:id',     count: 98,  p50: 12, p95: 38, errors: 0 },
  { method: 'PATCH',  path: '/api/users/:id',        count: 43,  p50: 28, p95: 88, errors: 3 },
]

const METHOD_COLOR: Record<string, string> = {
  GET:    'var(--info)',
  POST:   'var(--success)',
  PATCH:  'var(--warning)',
  DELETE: 'var(--error)',
  PUT:    'var(--warning)',
}

// ─── Export utilities ────────────────────────────────────────────────────────

/** Trigger a file download from a string blob in the browser */
function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Escape a value for CSV — wrap in quotes if it contains comma/quote/newline */
function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build a CSV string from headers + rows */
function buildCSV(headers: string[], rows: (string | number)[][]): string {
  return [
    headers.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ].join('\r\n')
}

/**
 * Build a minimal SpreadsheetML (XML) workbook with multiple sheets.
 * Opens natively in Excel, LibreOffice, Google Sheets, Numbers.
 * Zero dependencies — just a string template.
 */
function buildXLSX(
  sheets: { name: string; headers: string[]; rows: (string | number)[][] }[]
): string {
  const xmlCell = (v: string | number, isHeader = false): string => {
    const isNum = typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))
    const style = isHeader ? ' ss:StyleID="header"' : ''
    if (isNum) return `<Cell${style}><Data ss:Type="Number">${v}</Data></Cell>`
    const escaped = String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<Cell${style}><Data ss:Type="String">${escaped}</Data></Cell>`
  }

  const worksheets = sheets.map(({ name, headers, rows }) => {
    const headerRow = `<Row>${headers.map((h) => xmlCell(h, true)).join('')}</Row>`
    const dataRows  = rows.map((r) => `<Row>${r.map((c) => xmlCell(c)).join('')}</Row>`).join('')
    return `<Worksheet ss:Name="${name}"><Table>${headerRow}${dataRows}</Table></Worksheet>`
  }).join('')

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
    </Style>
  </Styles>
  ${worksheets}
</Workbook>`
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('24h')
  const [exportOpen, setExportOpen] = useState(false)
  const [exported, setExported] = useState<'csv' | 'xlsx' | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const spark = SPARK[range]
  const bars  = BARS[range]

  const rangeLabel: Record<Range, string> = {
    '24h': 'vs previous 24h',
    '7d':  'vs previous 7 days',
    '30d': 'vs previous 30 days',
  }

  // ── Build the three datasets for export ────────────────────────────────────
  function getExportData() {
    const volumeHeaders = ['Period', 'Requests']
    const volumeRows    = bars.labels.map((label, i) => [label, bars.requests[i]])

    const endpointHeaders = ['Method', 'Path', 'Requests', 'p50 (ms)', 'p95 (ms)', 'Errors']
    const endpointRows    = TOP_ENDPOINTS.map((ep) => [
      ep.method, ep.path, ep.count, ep.p50, ep.p95, ep.errors,
    ])

    const errorHeaders = ['Status', 'Count', 'Share (%)']
    const errorRows: (string | number)[][] = [
      ['400 Bad Request',    5, 45],
      ['401 Unauthorized',   3, 27],
      ['404 Not Found',      2, 18],
      ['500 Internal Error', 1, 10],
    ]

    return { volumeHeaders, volumeRows, endpointHeaders, endpointRows, errorHeaders, errorRows }
  }

  function handleExportCSV() {
    const { volumeHeaders, volumeRows, endpointHeaders, endpointRows, errorHeaders, errorRows } = getExportData()
    // Three separate CSV files bundled as one download via a zip would need a library;
    // instead export a single CSV with section headers — clean and dependency-free.
    const sections = [
      `# Request Volume (${range})\r\n` + buildCSV(volumeHeaders, volumeRows),
      `# Top Endpoints (${range})\r\n`  + buildCSV(endpointHeaders, endpointRows),
      `# Error Breakdown (${range})\r\n` + buildCSV(errorHeaders, errorRows),
    ].join('\r\n\r\n')
    downloadBlob(sections, `pyrocore-analytics-${range}.csv`, 'text/csv;charset=utf-8;')
    setExported('csv')
    setExportOpen(false)
    setTimeout(() => setExported(null), 2000)
  }

  function handleExportXLSX() {
    const { volumeHeaders, volumeRows, endpointHeaders, endpointRows, errorHeaders, errorRows } = getExportData()
    const xml = buildXLSX([
      { name: 'Request Volume',  headers: volumeHeaders,   rows: volumeRows   },
      { name: 'Top Endpoints',   headers: endpointHeaders, rows: endpointRows },
      { name: 'Error Breakdown', headers: errorHeaders,    rows: errorRows    },
    ])
    downloadBlob(xml, `pyrocore-analytics-${range}.xls`, 'application/vnd.ms-excel;charset=utf-8;')
    setExported('xlsx')
    setExportOpen(false)
    setTimeout(() => setExported(null), 2000)
  }

  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6 lg:space-y-8">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              API traffic, query performance, and storage for this project
            </p>
          </div>

          {/* Controls: range picker + export */}
          <div className="flex items-center gap-2 self-start sm:self-auto">

            {/* Range picker */}
            <div className="flex border border-border bg-background">
              {(['24h', '7d', '30d'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={[
                    'px-4 py-2 text-sm font-medium transition-colors min-h-[36px]',
                    range === r
                      ? 'text-white'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  ].join(' ')}
                  style={range === r ? { backgroundColor: 'var(--pyro-orange)' } : {}}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* Export dropdown */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((o) => !o)}
                className="flex items-center gap-2 px-3 py-2 border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[36px]"
                aria-label="Export data"
              >
                {exported ? (
                  <Check className="w-4 h-4" style={{ color: 'var(--success)' }} />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                  {exported === 'csv' ? 'Exported CSV' : exported === 'xlsx' ? 'Exported XLS' : 'Export'}
                </span>
              </button>

              {exportOpen && (
                <>
                  {/* Click-outside scrim */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setExportOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-20 min-w-44 overflow-hidden">
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-xs text-muted-foreground">
                        Exports cover request volume, top endpoints, and error breakdown for the selected range ({range}).
                      </p>
                    </div>
                    <button
                      onClick={handleExportCSV}
                      className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-3 min-h-[44px]"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-8">CSV</span>
                      <div>
                        <p className="text-sm text-foreground">Export as CSV</p>
                        <p className="text-xs text-muted-foreground">Single file, three sections</p>
                      </div>
                    </button>
                    <button
                      onClick={handleExportXLSX}
                      className="w-full px-4 py-3 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-3 min-h-[44px] border-t border-border"
                    >
                      <span className="text-xs font-mono text-muted-foreground w-8">XLS</span>
                      <div>
                        <p className="text-sm text-foreground">Export as XLS</p>
                        <p className="text-xs text-muted-foreground">Three sheets, bold headers</p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Stat cards — 2-up mobile, 4-up desktop ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <StatCard
            label="API Requests"
            value={range === '24h' ? '1,247' : range === '7d' ? '7,632' : '31,480'}
            subtext={rangeLabel[range]}
            trend="up"
            trendLabel={range === '24h' ? '+12%' : range === '7d' ? '+8%' : '+21%'}
            sparkData={spark.requests}
          />
          <StatCard
            label="Median Latency"
            value={range === '24h' ? '22 ms' : range === '7d' ? '24 ms' : '23 ms'}
            subtext="p50 across all endpoints"
            trend="flat"
            trendLabel="stable"
            sparkData={spark.latency}
            sparkColor="var(--info)"
          />
          <StatCard
            label="Error Rate"
            value={range === '24h' ? '0.9%' : range === '7d' ? '1.1%' : '0.8%'}
            subtext="4xx + 5xx / total"
            trend={range === '30d' ? 'down' : 'up'}
            trendLabel={range === '24h' ? '+0.2pp' : range === '7d' ? '+0.3pp' : '-0.4pp'}
            sparkData={spark.errors}
            sparkColor="var(--error)"
          />
          <StatCard
            label="Storage Used"
            value={range === '24h' ? '18.5 GB' : range === '7d' ? '18.5 GB' : '17.1 GB'}
            subtext="of 100 GB limit"
            trend="up"
            trendLabel={range === '24h' ? '+0.1 GB' : range === '7d' ? '+0.8 GB' : '+1.4 GB'}
            sparkData={spark.storage}
            sparkColor="var(--warning)"
          />
        </div>

        {/* ── Request volume chart ── */}
        <div className="bg-card border border-border p-4 lg:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Request volume</h2>
            <span className="text-xs text-muted-foreground">
              {range === '24h' ? 'Hourly' : range === '7d' ? 'Daily' : 'Daily'} buckets
            </span>
          </div>

          {/* Y-axis labels + bar chart */}
          <div className="flex gap-3">
            {/* Y-axis */}
            <div className="flex flex-col justify-between text-xs font-mono text-muted-foreground text-right w-10 flex-shrink-0 pb-5">
              <span>{Math.max(...bars.requests)}</span>
              <span>{Math.round(Math.max(...bars.requests) / 2)}</span>
              <span>0</span>
            </div>

            {/* Chart area */}
            <div className="flex-1 min-w-0">
              <BarChart
                data={bars.requests}
                labels={bars.labels}
                color="var(--pyro-orange)"
              />
              {/* X-axis labels — show subset to avoid crowding */}
              <div className="flex justify-between mt-1">
                {bars.labels
                  .filter((_, i) => {
                    const step = Math.ceil(bars.labels.length / 6)
                    return i % step === 0 || i === bars.labels.length - 1
                  })
                  .map((l) => (
                    <span key={l} className="text-xs font-mono text-muted-foreground">
                      {l}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Database activity — 2-col on desktop ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* DB reads */}
          <div className="bg-card border border-border p-4 lg:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">DB reads</h2>
              <span className="text-xs text-muted-foreground">
                {range === '24h' ? '8,420' : range === '7d' ? '52,140' : '214,300'} total
              </span>
            </div>
            <Sparkline data={spark.dbReads} color="var(--info)" filled />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground font-mono">
              <span>p50: 8 ms</span>
              <span>p95: 31 ms</span>
              <span>p99: 62 ms</span>
            </div>
          </div>

          {/* DB writes */}
          <div className="bg-card border border-border p-4 lg:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">DB writes</h2>
              <span className="text-xs text-muted-foreground">
                {range === '24h' ? '1,840' : range === '7d' ? '11,200' : '45,600'} total
              </span>
            </div>
            <Sparkline data={spark.dbWrites} color="var(--success)" filled />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground font-mono">
              <span>p50: 12 ms</span>
              <span>p95: 44 ms</span>
              <span>p99: 89 ms</span>
            </div>
          </div>
        </div>

        {/* ── Top endpoints table ── */}
        <div className="bg-card border border-border overflow-hidden">
          <div className="px-4 lg:px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Top endpoints</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ranked by request count · latency in ms
            </p>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-foreground">Endpoint</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground">Requests</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground">p50</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground">p95</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground">Errors</th>
                </tr>
              </thead>
              <tbody>
                {TOP_ENDPOINTS.map((ep, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-mono font-semibold w-14 flex-shrink-0"
                          style={{ color: METHOD_COLOR[ep.method] ?? 'var(--muted-foreground)' }}
                        >
                          {ep.method}
                        </span>
                        <code className="text-sm font-mono text-foreground">{ep.path}</code>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-mono text-foreground">
                      {ep.count.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-mono text-muted-foreground">
                      {ep.p50}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-mono text-muted-foreground">
                      {ep.p95}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {ep.errors > 0 ? (
                        <span className="text-sm font-mono" style={{ color: 'var(--error)' }}>
                          {ep.errors}
                        </span>
                      ) : (
                        <span className="text-sm font-mono text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — stacked rows */}
          <div className="lg:hidden divide-y divide-border">
            {TOP_ENDPOINTS.map((ep, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-xs font-mono font-semibold w-14 flex-shrink-0"
                    style={{ color: METHOD_COLOR[ep.method] ?? 'var(--muted-foreground)' }}
                  >
                    {ep.method}
                  </span>
                  <code className="text-sm font-mono text-foreground truncate">{ep.path}</code>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground pl-16">
                  <span>{ep.count.toLocaleString()} req</span>
                  <span>p50: {ep.p50} ms</span>
                  <span>p95: {ep.p95} ms</span>
                  {ep.errors > 0 && (
                    <span style={{ color: 'var(--error)' }}>{ep.errors} err</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Error breakdown ── */}
        <div className="bg-card border border-border p-4 lg:p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Error breakdown</h2>
          <div className="space-y-3">
            {[
              { code: '400 Bad Request',     count: 5,  pct: 45 },
              { code: '401 Unauthorized',    count: 3,  pct: 27 },
              { code: '404 Not Found',       count: 2,  pct: 18 },
              { code: '500 Internal Error',  count: 1,  pct: 10 },
            ].map(({ code, count, pct }) => (
              <div key={code} className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground w-36 flex-shrink-0">{code}</span>
                {/* Bar */}
                <div className="flex-1 h-1.5 bg-border overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: code.startsWith('5') ? 'var(--error)' : 'var(--warning)',
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-foreground w-6 text-right flex-shrink-0">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </PyroCoreLayout>
  )
}
