import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Download, ChevronLeft, ChevronRight, Info, ArrowRight, Minus, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { api, downloadApi, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty } from '../components/Layout'

const PAGE_SIZES = [50, 250, 1000]
const todayISO = () => new Date().toISOString().slice(0, 10)
const daysAgoISO = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

const TABS = [
  { key: 'daily',     label: 'Daily prices' },
  { key: 'snapshots', label: 'Snapshots' },
  { key: 'runs',      label: 'Runs' },
  { key: 'items',     label: 'Last modified' },
]

const DAILY_VIEWS = [
  { key: 'changes',  label: 'Price changes' },
  { key: 'calendar', label: 'Full calendar' },
]

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

function itemLabel(sku, name) {
  const s = (sku || '').trim()
  const n = (name || '').trim()
  if (!s && !n) return { primary: '—', secondary: null }
  if (!s || s === n) return { primary: n || s, secondary: null }
  if (n && n.includes(s)) return { primary: n, secondary: null }
  return { primary: n || s, secondary: s }
}

function ItemCell({ sku, name }) {
  const { primary, secondary } = itemLabel(sku, name)
  return (
    <div className="min-w-0">
      <div className="text-sm text-gray-900 truncate" title={primary}>{primary}</div>
      {secondary && <div className="font-mono text-[11px] text-gray-400 truncate" title={secondary}>{secondary}</div>}
    </div>
  )
}

function pctChange(prev, next) {
  if (prev == null || next == null || prev === 0) return null
  return ((next - prev) / prev) * 100
}

function RateChangeCell({ prev, rate }) {
  if (prev == null || prev === rate) {
    return <span className="text-sm font-medium text-gray-900">{fmt(rate)}</span>
  }
  const pct = pctChange(prev, rate)
  const up = rate > prev
  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
      <span className="text-xs text-gray-400 line-through">{fmt(prev)}</span>
      <ArrowRight size={12} className="text-gray-300 shrink-0" />
      <span className="text-sm font-semibold text-gray-900">{fmt(rate)}</span>
      {pct != null && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          up ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {up ? '+' : ''}{pct.toFixed(1)}%
        </span>
      )}
    </div>
  )
}

function groupDailyRows(rows) {
  const groups = []
  const byId = new Map()
  for (const r of rows) {
    if (!byId.has(r.item_id)) {
      const g = { item_id: r.item_id, sku: r.sku, name: r.name, rows: [] }
      byId.set(r.item_id, g)
      groups.push(g)
    }
    byId.get(r.item_id).rows.push(r)
  }
  return groups
}

const SNAPSHOT_COLS = [
  { h: 'Item', cell: r => <ItemCell sku={r.sku} name={r.name} />, wide: true },
  { h: 'Rate', cell: r => <span className="text-sm font-medium">{fmt(r.rate)}</span>, right: true },
  { h: 'Status', cell: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status || '—'}</span>) },
  { h: 'Captured At',        cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.captured_at} /></span> },
  { h: 'Zoho Last Modified', cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.zoho_last_modified_time} /></span> },
]

const RUN_COLS = [
  { h: 'Started At',  cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.started_at} /></span> },
  { h: 'Finished At', cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.finished_at} /></span> },
  { h: 'Status', cell: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        r.status === 'ok' ? 'bg-green-100 text-green-700'
        : r.status === 'running' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{r.status || '—'}</span>) },
  { h: 'Items',   cell: r => <span className="text-sm">{r.item_count ?? '—'}</span>, right: true },
  { h: 'Changed', cell: r => <span className="text-sm">{r.changed_count ?? '—'}</span>, right: true },
]

const ITEM_COLS = [
  { h: 'Item', sortKey: 'sku', cell: r => <ItemCell sku={r.sku} name={r.name} />, wide: true },
  { h: 'Rate', sortKey: 'rate', cell: r => <span className="text-sm font-medium">{fmt(r.rate)}</span>, right: true },
  { h: 'Qty sold', sortKey: 'qty_sold', cell: r => <span className="text-sm font-medium tabular-nums">{Number(r.qty_sold ?? 0).toLocaleString()}</span>, right: true },
  { h: 'Status', cell: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status || '—'}</span>) },
  { h: 'Product Type', cell: r => <span className="text-sm text-gray-600">{r.product_type || '—'}</span> },
  { h: 'Zoho Last Modified', sortKey: 'modified', cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.last_modified_time} /></span> },
  { h: 'Last Synced', cell: r => <span className="text-xs text-gray-500"><TimeCell value={r.synced_at} /></span> },
]

const ITEM_SORT_LABELS = {
  qty_sold: 'qty sold',
  modified: 'Zoho last modified',
  rate: 'rate',
  sku: 'SKU',
}

function SortTh({ col, sort, order, onSort }) {
  if (!col.sortKey) {
    return <th className={`th ${col.right ? 'text-right' : ''}`}>{col.h}</th>
  }
  const active = sort === col.sortKey
  return (
    <th className={`th ${col.right ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(col.sortKey)}
        className={`inline-flex items-center gap-1 hover:text-navy-700 ${col.right ? 'ml-auto' : ''} ${active ? 'text-navy-700 font-semibold' : ''}`}
        title={`Sort by ${col.h}`}
      >
        {col.h}
        {active
          ? (order === 'desc' ? <ChevronDown size={14} /> : <ChevronUp size={14} />)
          : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  )
}

const rowKey = (tab, r, i) =>
  tab === 'daily' ? `${r.item_id}-${r.price_date}-${i}`
  : tab === 'snapshots' ? r.id
  : tab === 'items' ? (r.item_id ?? r.sku ?? i)
  : (r.id ?? r.run_id)

function DailyChangesTable({ rows }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b bg-gray-50/80">
          <th className="th w-[42%]">Item</th>
          <th className="th w-28">Date</th>
          <th className="th text-right">Price change</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r, i) => (
          <tr key={rowKey('daily', r, i)} className="tr-hover">
            <td className="td max-w-md"><ItemCell sku={r.sku} name={r.name} /></td>
            <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDate(r.price_date)}</td>
            <td className="td text-right"><RateChangeCell prev={r.prev_rate} rate={r.rate} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DailyCalendarTable({ groups }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b bg-gray-50/80">
          <th className="th w-[42%]">Item</th>
          <th className="th w-28">Date</th>
          <th className="th text-right w-32">Rate</th>
        </tr>
      </thead>
      <tbody>
        {groups.map(g => {
          const stable = g.rows.every(r => r.rate === g.rows[0]?.rate)
          return g.rows.map((r, i) => (
            <tr key={`${g.item_id}-${r.price_date}`} className={`tr-hover ${i === 0 ? 'border-t border-gray-200' : ''}`}>
              {i === 0 && (
                <td className="td align-top max-w-md" rowSpan={g.rows.length}>
                  <ItemCell sku={g.sku} name={g.name} />
                  {stable && g.rows.length > 1 && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                      <Minus size={10} /> Same rate all {g.rows.length} days
                    </div>
                  )}
                </td>
              )}
              <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDate(r.price_date)}</td>
              <td className="td text-right text-sm font-medium">{fmt(r.rate)}</td>
            </tr>
          ))
        })}
      </tbody>
    </table>
  )
}

export default function ZohoPriceHistory() {
  const [tab, setTab] = useState('daily')
  const [dailyView, setDailyView] = useState('changes')
  const [from, setFrom] = useState(daysAgoISO(7))
  const [to, setTo]     = useState(todayISO())
  const [q, setQ]       = useState('')
  const [qApplied, setQApplied] = useState('')
  const [status, setStatus]     = useState('all')
  const [changedInPeriod, setChangedInPeriod] = useState(false)
  const [modFrom, setModFrom] = useState('')
  const [modTo, setModTo] = useState('')
  const [soldFrom, setSoldFrom] = useState(daysAgoISO(30))
  const [soldTo, setSoldTo] = useState(todayISO())
  const [itemSort, setItemSort] = useState('qty_sold')
  const [itemOrder, setItemOrder] = useState('desc')
  const [limit, setLimit] = useState(250)
  const [offset, setOffset] = useState(0)

  const [data, setData]   = useState({ rows: [], total: 0, has_more: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const onlyChanges = tab === 'daily' && dailyView === 'changes'

  useEffect(() => {
    const t = setTimeout(() => { setQApplied(q.trim()); setOffset(0) }, 400)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => { setOffset(0) }, [tab, from, to, status, dailyView, limit, changedInPeriod, modFrom, modTo, soldFrom, soldTo, itemSort, itemOrder])

  const handleItemSort = useCallback((key) => {
    setOffset(0)
    if (itemSort === key) {
      setItemOrder(o => (o === 'desc' ? 'asc' : 'desc'))
    } else {
      setItemSort(key)
      setItemOrder(key === 'sku' ? 'asc' : 'desc')
    }
  }, [itemSort])

  const params = useMemo(() => {
    const p = { limit, offset }
    if (tab === 'items') {
      if (qApplied) p.q = qApplied
      if (status !== 'all') p.status = status
      if (modFrom) p.modFrom = modFrom
      if (modTo) p.modTo = modTo
      if (soldFrom) p.soldFrom = soldFrom
      if (soldTo) p.soldTo = soldTo
      p.sort = itemSort
      p.order = itemOrder
      return p
    }
    p.from = from
    p.to = to
    if (tab !== 'runs') {
      if (qApplied) p.q = qApplied
      if (status !== 'all') p.status = status
    }
    if (onlyChanges) p.onlyChanges = true
    if (changedInPeriod) p.changedInPeriod = true
    return p
  }, [tab, from, to, qApplied, status, onlyChanges, changedInPeriod, limit, offset, modFrom, modTo, soldFrom, soldTo, itemSort, itemOrder])

  const load = useCallback(() => {
    setLoading(true); setError(null)
    const call = tab === 'daily' ? api.zohoDaily
      : tab === 'snapshots' ? api.zohoSnapshots
      : tab === 'items' ? api.zohoItems
      : api.zohoRuns
    call(params)
      .then(d => setData({ rows: d.rows || [], total: d.total || 0, has_more: !!d.has_more }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [tab, params])

  useEffect(() => { load() }, [load])

  const dailyGroups = useMemo(
    () => (tab === 'daily' && dailyView === 'calendar' ? groupDailyRows(data.rows) : []),
    [tab, dailyView, data.rows],
  )

  const exportXlsx = () => {
    const p = tab === 'items'
      ? {}
      : { from, to }
    if (tab !== 'runs') {
      if (qApplied) p.q = qApplied
      if (status !== 'all') p.status = status
    }
    if (tab === 'items') {
      if (modFrom) p.modFrom = modFrom
      if (modTo) p.modTo = modTo
      if (soldFrom) p.soldFrom = soldFrom
      if (soldTo) p.soldTo = soldTo
      p.sort = itemSort
      p.order = itemOrder
    } else {
      if (onlyChanges) p.onlyChanges = true
      if (changedInPeriod) p.changedInPeriod = true
    }
    downloadApi(`/zoho-price-history/${tab}/export`, p, `zoho-price-history-${tab}.xlsx`).catch(e => setError(e.message))
  }

  const cols = tab === 'snapshots' ? SNAPSHOT_COLS : tab === 'runs' ? RUN_COLS : tab === 'items' ? ITEM_COLS : null
  const showStatus = tab !== 'runs'
  const showSearch = tab !== 'runs'
  const showCaptureDates = tab !== 'items'
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

      <div className="flex gap-1 px-4 sm:px-6 mb-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-navy-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 mb-4">
        {showCaptureDates && (
          <div className="flex items-center gap-2">
            <input type="date" className="input w-40" value={from} onChange={e => setFrom(e.target.value)} max={to} />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" className="input w-40" value={to} onChange={e => setTo(e.target.value)} min={from} />
          </div>
        )}
        {tab === 'items' && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm whitespace-nowrap">Sales period</span>
              <input type="date" className="input w-40" value={soldFrom} onChange={e => setSoldFrom(e.target.value)} max={soldTo || undefined} title="Qty sold — order date from" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" className="input w-40" value={soldTo} onChange={e => setSoldTo(e.target.value)} min={soldFrom || undefined} title="Qty sold — order date to" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm whitespace-nowrap">Modified in Zoho</span>
              <input type="date" className="input w-40" value={modFrom} onChange={e => setModFrom(e.target.value)} max={modTo || undefined} title="Optional — from date" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" className="input w-40" value={modTo} onChange={e => setModTo(e.target.value)} min={modFrom || undefined} title="Optional — to date" />
            </div>
          </>
        )}
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
        {(tab === 'daily' || tab === 'snapshots') && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={changedInPeriod}
              onChange={e => setChangedInPeriod(e.target.checked)}
            />
            Changed price in period
          </label>
        )}
        {tab === 'daily' && (
          <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {DAILY_VIEWS.map(v => (
              <button key={v.key} type="button" onClick={() => setDailyView(v.key)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  dailyView === v.key ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        <select className="select w-28" value={limit} onChange={e => setLimit(Number(e.target.value))} title="Page size">
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>

      {tab === 'daily' && !loading && (
        <p className="px-4 sm:px-6 -mt-2 mb-3 text-xs text-gray-500">
          {onlyChanges
            ? `${data.total.toLocaleString()} price change${data.total === 1 ? '' : 's'} in range — items with a stable rate are hidden.`
            : `${dailyGroups.length.toLocaleString()} item${dailyGroups.length === 1 ? '' : 's'}, ${data.total.toLocaleString()} day row${data.total === 1 ? '' : 's'} — grouped by SKU.`}
          {changedInPeriod && ' Showing only SKUs with at least one rate change in the selected dates.'}
        </p>
      )}
      {tab === 'snapshots' && !loading && changedInPeriod && (
        <p className="px-4 sm:px-6 -mt-2 mb-3 text-xs text-gray-500">
          Showing snapshots for SKUs that changed price at least once between {from} and {to}.
        </p>
      )}
      {tab === 'items' && !loading && (
        <p className="px-4 sm:px-6 -mt-2 mb-3 text-xs text-gray-500">
          {data.total.toLocaleString()} Zoho catalog item{data.total === 1 ? '' : 's'} — sorted by {ITEM_SORT_LABELS[itemSort] || itemSort} ({itemOrder === 'desc' ? 'high → low' : 'low → high'}).
          Qty sold sums product line quantities from Zoho orders ({soldFrom} → {soldTo}), excluding void/cancelled/refunded.
          {modFrom || modTo ? ` Item list filtered to modified ${modFrom || '…'} → ${modTo || '…'}.` : ''}
          {' '}Click column headers to re-sort.
        </p>
      )}

      {error && <ErrorMsg error={error} />}

      <div className="px-4 sm:px-6 pb-8">
        <div className="card overflow-x-auto">
          {loading ? (
            <div className="p-8"><Spinner /></div>
          ) : data.rows.length === 0 ? (
            <Empty label={onlyChanges ? 'No price changes in this date range' : tab === 'items' ? 'No items match these filters' : 'No rows for these filters'} />
          ) : tab === 'daily' ? (
            onlyChanges
              ? <DailyChangesTable rows={data.rows} />
              : <DailyCalendarTable groups={dailyGroups} />
          ) : tab === 'items' ? (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50/80">
                  {ITEM_COLS.map(c => (
                    <SortTh key={c.h} col={c} sort={itemSort} order={itemOrder} onSort={handleItemSort} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map((r, i) => (
                  <tr key={rowKey(tab, r, i)} className="tr-hover">
                    {ITEM_COLS.map(c => (
                      <td key={c.h} className={`td ${c.right ? 'text-right' : ''} ${c.wide ? 'max-w-md' : ''}`}>{c.cell(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50/80">
                  {cols.map(c => <th key={c.h} className={`th ${c.right ? 'text-right' : ''}`}>{c.h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map((r, i) => (
                  <tr key={rowKey(tab, r, i)} className="tr-hover">
                    {cols.map(c => <td key={c.h} className={`td ${c.right ? 'text-right' : ''} ${c.wide ? 'max-w-md' : ''}`}>{c.cell(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
