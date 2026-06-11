import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Download, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty } from '../components/Layout'

const PAGE_SIZES = [50, 250, 1000]
const todayISO = () => new Date().toISOString().slice(0, 10)
const daysAgoISO = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

const TABS = [
  { key: 'daily',     label: 'Daily prices' },
  { key: 'snapshots', label: 'Snapshots' },
  { key: 'runs',      label: 'Runs' },
]

// datetime rendered in local tz, with a UTC tooltip badge
function TimeCell({ value }) {
  if (!value) return <span className="text-gray-300">—</span>
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return <span className="text-gray-400">{String(value)}</span>
  const utc = d.toISOString()
  return (
    <span className="whitespace-nowrap" title={`UTC: ${utc}`}>
      {d.toLocaleString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      <span className="ml-1 align-middle text-[9px] font-medium text-gray-400 border border-gray-200 rounded px-1"
        title={`UTC: ${utc}`}>UTC</span>
    </span>
  )
}

const Mono = ({ children }) => <span className="font-mono text-xs text-gray-600">{children || '—'}</span>

// Column defs per sub-tab (header + cell renderer)
const COLUMNS = {
  daily: [
    { h: 'SKU',  cell: r => <span className="font-mono text-xs">{r.sku || '—'}</span> },
    { h: 'Name', cell: r => <span className="text-sm">{r.name || '—'}</span>, wide: true },
    { h: 'Date', cell: r => <span className="text-sm text-gray-600 whitespace-nowrap">{fmtDate(r.price_date)}</span> },
    { h: 'Rate', cell: r => <span className="text-sm font-medium">{fmt(r.rate)}</span>, right: true },
  ],
  snapshots: [
    { h: 'SKU',  cell: r => <span className="font-mono text-xs">{r.sku || '—'}</span> },
    { h: 'Name', cell: r => <span className="text-sm">{r.name || '—'}</span>, wide: true },
    { h: 'Rate', cell: r => <span className="text-sm font-medium">{fmt(r.rate)}</span>, right: true },
    { h: 'Status', cell: r => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
          r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status || '—'}</span>) },
    { h: 'Captured At',        cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.captured_at} /></span> },
    { h: 'Zoho Last Modified', cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.zoho_last_modified_time} /></span> },
  ],
  runs: [
    { h: 'Started At',  cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.started_at} /></span> },
    { h: 'Finished At', cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.finished_at} /></span> },
    { h: 'Status', cell: r => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
          r.status === 'ok' ? 'bg-green-100 text-green-700'
          : r.status === 'running' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{r.status || '—'}</span>) },
    { h: 'Items',   cell: r => <span className="text-sm">{r.item_count ?? '—'}</span>, right: true },
    { h: 'Changed', cell: r => <span className="text-sm">{r.changed_count ?? '—'}</span>, right: true },
  ],
}

const rowKey = (tab, r, i) =>
  tab === 'daily' ? `${r.item_id}-${r.price_date}-${i}`
  : tab === 'snapshots' ? r.id
  : (r.id ?? r.run_id)

export default function ZohoPriceHistory() {
  const [tab, setTab] = useState('daily')
  const [from, setFrom] = useState(daysAgoISO(30))
  const [to, setTo]     = useState(todayISO())
  const [q, setQ]       = useState('')
  const [qApplied, setQApplied] = useState('')
  const [status, setStatus]     = useState('all')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const [limit, setLimit] = useState(250)
  const [offset, setOffset] = useState(0)

  const [data, setData]   = useState({ rows: [], total: 0, has_more: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // debounce free-text search
  useEffect(() => {
    const t = setTimeout(() => { setQApplied(q.trim()); setOffset(0) }, 400)
    return () => clearTimeout(t)
  }, [q])

  // reset paging when filters/tab change
  useEffect(() => { setOffset(0) }, [tab, from, to, status, onlyChanges, limit])

  // build query params for the active tab (only params that tab allows)
  const params = useMemo(() => {
    const p = { from, to, limit, offset }
    if (tab !== 'runs') {
      if (qApplied) p.q = qApplied
      if (status !== 'all') p.status = status
    }
    if (tab === 'daily' && onlyChanges) p.onlyChanges = true
    return p
  }, [tab, from, to, qApplied, status, onlyChanges, limit, offset])

  const load = useCallback(() => {
    setLoading(true); setError(null)
    const call = tab === 'daily' ? api.zohoDaily : tab === 'snapshots' ? api.zohoSnapshots : api.zohoRuns
    call(params)
      .then(d => setData({ rows: d.rows || [], total: d.total || 0, has_more: !!d.has_more }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [tab, params])

  useEffect(() => { load() }, [load])

  const exportXlsx = () => {
    const p = { from, to }
    if (tab !== 'runs') {
      if (qApplied) p.q = qApplied
      if (status !== 'all') p.status = status
    }
    if (tab === 'daily' && onlyChanges) p.onlyChanges = true
    const url = api.zohoExportUrl(tab, p)
    const a = document.createElement('a')
    a.href = url
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const cols = COLUMNS[tab]
  const showStatus = tab !== 'runs'
  const showSearch = tab !== 'runs'
  const pageStart = data.total === 0 ? 0 : offset + 1
  const pageEnd = offset + data.rows.length

  return (
    <div>
      <PageHeader
        title="Zoho Price History"
        subtitle="Read-only view of item price snapshots captured from Zoho (3×/day by an external service)"
        actions={
          <button className="btn-outline" onClick={exportXlsx} disabled={loading || data.total === 0} title="Export the filtered set to Excel">
            <Download size={14} /> Export to Excel
          </button>
        }
      />

      {/* Sub-tabs */}
      <div className="flex gap-1 px-4 sm:px-6 mb-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-navy-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 mb-4">
        <div className="flex items-center gap-2">
          <input type="date" className="input w-40" value={from} onChange={e => setFrom(e.target.value)} max={to} />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" className="input w-40" value={to} onChange={e => setTo(e.target.value)} min={from} />
        </div>
        {showSearch && (
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input className="input pl-8 w-60" placeholder="Search SKU or name…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        )}
        {showStatus && (
          <select className="select w-40" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        )}
        {tab === 'daily' && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={onlyChanges} onChange={e => setOnlyChanges(e.target.checked)} />
            Only days with price change
          </label>
        )}
        <select className="select w-28" value={limit} onChange={e => setLimit(Number(e.target.value))} title="Page size">
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {error && <ErrorMsg error={error} />}

      <div className="px-4 sm:px-6 pb-8">
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {cols.map(c => <th key={c.h} className={`th ${c.right ? 'text-right' : ''}`}>{c.h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={cols.length}><Spinner /></td></tr>
                : data.rows.length === 0
                  ? <tr><td colSpan={cols.length}><Empty label="No rows for these filters" /></td></tr>
                  : data.rows.map((r, i) => (
                    <tr key={rowKey(tab, r, i)} className="tr-hover">
                      {cols.map(c => <td key={c.h} className={`td ${c.right ? 'text-right' : ''} ${c.wide ? 'max-w-xs truncate' : ''}`}>{c.cell(r)}</td>)}
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>{loading ? 'Loading…' : `Showing ${pageStart}–${pageEnd} of ${data.total.toLocaleString()}`}</span>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0 || loading}>
              <ChevronLeft size={14} /> Prev
            </button>
            <button className="btn-outline" onClick={() => setOffset(offset + limit)} disabled={!data.has_more || loading}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>Read-only. Times shown in your local timezone (hover the <span className="border border-gray-200 rounded px-1">UTC</span> badge for UTC). This view never modifies the capture tables or affects commission/invoice automation.</span>
        </div>
      </div>
    </div>
  )
}
