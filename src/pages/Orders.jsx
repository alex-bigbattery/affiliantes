import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty, StatCard } from '../components/Layout'
import ExportButtons from '../components/ExportButtons'

const PAGE_SIZE = 50
const DEFAULT_TAB = 'wc_affiliate'
const WC_ADMIN_ORDER = 'https://bigbattery.com/wp-admin/admin.php?page=wc-orders&action=edit&id='

const SEGMENTS = {
  so:               { label: 'SO orders',              short: 'Zoho B2B / quote orders (SO- prefix), no affiliate coupon' },
  bb:               { label: 'BB orders',              short: 'WooCommerce web orders (BB prefix), no affiliate coupon' },
  wc_affiliate:     { label: 'Affiliate Coupon',       short: 'Affiliate coupon linked in WooCommerce → AffiliateWP (commission applies)' },
  zoho_affiliate:   { label: 'Zoho affiliate coupon',  short: 'Affiliate-type coupon on Zoho orders, not linked in WooCommerce' },
  affiliate_coupon: { label: 'All affiliate coupons',  short: 'WC-linked first, then Zoho-only affiliate coupons' },
  all:              { label: 'All',                    short: 'Every Zoho sales order' },
}

const SEGMENT_COLORS = {
  so:               '#475569',
  bb:               '#2563eb',
  wc_affiliate:     '#16a34a',
  zoho_affiliate:   '#9333ea',
  affiliate_coupon: '#059669',
  other:            '#9ca3af',
}

const SEGMENT_BADGE = {
  so:               'bg-slate-100 text-slate-700',
  bb:               'bg-blue-100 text-blue-800',
  wc_affiliate:     'bg-green-100 text-green-800',
  zoho_affiliate:   'bg-purple-100 text-purple-800',
  affiliate_coupon: 'bg-emerald-100 text-emerald-800',
  other:            'bg-gray-100 text-gray-600',
}

const ROW_ACCENT = {
  so:               'border-l-4 border-l-slate-400',
  bb:               'border-l-4 border-l-blue-500',
  wc_affiliate:     'border-l-4 border-l-green-500',
  zoho_affiliate:   'border-l-4 border-l-purple-500',
  affiliate_coupon: 'border-l-4 border-l-emerald-500',
  other:            'border-l-4 border-l-gray-300',
}

const SOURCE_BADGE = {
  woocommerce: 'bg-green-100 text-green-800',
  zoho:        'bg-purple-100 text-purple-800',
}

const EXPORT_COLUMNS = [
  { header: 'Segment',         value: o => SEGMENTS[o.segment]?.label || o.segment || '' },
  { header: 'Source',          value: o => o.affiliate_source || '' },
  { header: 'Order #',         value: o => o.salesorder_number || o.salesorder_id },
  { header: 'WC ID',           value: o => o.wc_order_id ?? '' },
  { header: 'Date',            value: o => o.order_date ? String(o.order_date).slice(0, 10) : '' },
  { header: 'Customer',        value: o => o.customer_name || '' },
  { header: 'Coupon',          value: o => o.coupon_code || '' },
  { header: 'Affiliate',       value: o => o.affiliate_name || '' },
  { header: 'AWP ID',          value: o => o.affiliate_id ?? '' },
  { header: 'Subtotal',        value: o => Number(o.sub_total || 0) },
  { header: 'Total',           value: o => Number(o.total || 0) },
  { header: 'Est. commission', value: o => o.est_commission != null ? Number(o.est_commission) : '' },
  { header: 'Status',          value: o => o.status || '' },
  { header: 'Reference',       value: o => o.reference_number || '' },
]

function inferSegment(o) {
  if (o.segment) return o.segment
  const num = String(o.salesorder_number || '').toUpperCase()
  const coupon = String(o.coupon_code || '').toLowerCase().trim()
  const hasCoupon = coupon && !['.', '-', 'n/a', 'na', 'none'].includes(coupon)
  if (hasCoupon && o.affiliate_id) return 'wc_affiliate'
  if (hasCoupon && o.coupon_kind === 'affiliate') return 'zoho_affiliate'
  if (num.startsWith('BB')) return 'bb'
  if (num.startsWith('SO')) return 'so'
  return 'other'
}

function inferSource(o) {
  if (o.affiliate_source) return o.affiliate_source
  const seg = inferSegment(o)
  if (seg === 'wc_affiliate') return 'woocommerce'
  if (seg === 'zoho_affiliate') return 'zoho'
  return null
}

function SegmentBadge({ segment }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SEGMENT_BADGE[segment] || SEGMENT_BADGE.other}`}>
      {SEGMENTS[segment]?.label || segment}
    </span>
  )
}

function WcOrderId({ id }) {
  if (!id) return <span className="text-gray-300">—</span>
  return (
    <a href={`${WC_ADMIN_ORDER}${id}`} target="_blank" rel="noopener noreferrer"
      className="font-mono text-sm text-blue-600 hover:underline" title="Open in WooCommerce admin">
      {id}
    </a>
  )
}

function wcCell(o) {
  return <td className="td font-mono text-sm"><WcOrderId id={o.wc_order_id} /></td>
}

function SourceBadge({ source }) {
  if (!source) return <span className="text-gray-300">—</span>
  const label = source === 'woocommerce' ? 'WC linked' : 'Zoho only'
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_BADGE[source] || SOURCE_BADGE.zoho}`}>
      {label}
    </span>
  )
}

function tableHeaders(tab) {
  if (tab === 'wc_affiliate') {
    return ['Order #', 'WC ID', 'Date', 'Customer', 'Coupon', 'Affiliate', 'AWP ID', 'Subtotal', 'Total', 'Commission', 'Status']
  }
  if (tab === 'zoho_affiliate') {
    return ['Order #', 'WC ID', 'Date', 'Customer', 'Coupon', 'Subtotal', 'Total', 'Status']
  }
  if (tab === 'affiliate_coupon') {
    return ['Order #', 'WC ID', 'Source', 'Date', 'Customer', 'Coupon', 'Affiliate', 'AWP ID', 'Subtotal', 'Total', 'Commission', 'Status']
  }
  if (tab === 'bb' || tab === 'so') {
    return ['Order #', 'WC ID', 'Date', 'Customer', 'Coupon', 'Subtotal', 'Total', 'Status', 'Reference']
  }
  return ['Order #', 'WC ID', 'Type', 'Date', 'Customer', 'Coupon', 'Affiliate', 'Subtotal', 'Total', 'Commission', 'Status']
}

function OrderRow({ o, tab }) {
  const seg = inferSegment(o)
  const source = inferSource(o)
  const accent = ROW_ACCENT[seg] || ROW_ACCENT.other
  const commission = o.est_commission != null
    ? <span className="font-semibold text-brand-orange">{fmt(o.est_commission)}</span>
    : <span className="text-gray-300">—</span>

  if (tab === 'wc_affiliate') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT.wc_affiliate}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        {wcCell(o)}
        <td className="td text-sm text-gray-600">{fmtDate(o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <td className="td text-sm max-w-[130px] truncate" title={o.affiliate_name}>{o.affiliate_name || '—'}</td>
        <td className="td text-sm font-mono text-gray-500">{o.affiliate_id ?? '—'}</td>
        <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
        <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
        <td className="td text-right text-sm">{commission}</td>
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
      </tr>
    )
  }

  if (tab === 'zoho_affiliate') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT.zoho_affiliate}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        {wcCell(o)}
        <td className="td text-sm text-gray-600">{fmtDate(o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
        <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
      </tr>
    )
  }

  if (tab === 'affiliate_coupon') {
    return (
      <tr className={`tr-hover ${accent}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        {wcCell(o)}
        <td className="td"><SourceBadge source={source} /></td>
        <td className="td text-sm text-gray-600">{fmtDate(o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <td className="td text-sm max-w-[130px] truncate" title={o.affiliate_name}>{o.affiliate_name || '—'}</td>
        <td className="td text-sm font-mono text-gray-500">{o.affiliate_id ?? '—'}</td>
        <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
        <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
        <td className="td text-right text-sm">{commission}</td>
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
      </tr>
    )
  }

  if (tab === 'bb' || tab === 'so') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT[tab]}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        {wcCell(o)}
        <td className="td text-sm text-gray-600">{fmtDate(o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <td className="td font-mono text-sm">{o.coupon_code || <span className="text-gray-300">—</span>}</td>
        <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
        <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <td className="td text-xs text-gray-500 font-mono">{o.reference_number || '—'}</td>
      </tr>
    )
  }

  return (
    <tr className={`tr-hover ${accent}`}>
      <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
      {wcCell(o)}
      <td className="td"><SegmentBadge segment={seg} /></td>
      <td className="td text-sm text-gray-600">{fmtDate(o.order_date)}</td>
      <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
      <td className="td font-mono text-sm">{o.coupon_code || <span className="text-gray-300">—</span>}</td>
      <td className="td text-sm max-w-[130px] truncate" title={o.affiliate_name}>{o.affiliate_name || '—'}</td>
      <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
      <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
      <td className="td text-right text-sm">{commission}</td>
      <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
    </tr>
  )
}

function SegmentCard({ label, value, sub, color, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left w-full rounded-xl transition-all ${
        active ? 'ring-2 ring-navy-700 ring-offset-2 shadow-md' : 'hover:shadow-sm'}`}>
      <StatCard label={label} value={value} sub={sub} color={color} />
    </button>
  )
}

function SegmentBreakdownBar({ segments }) {
  const total = segments.reduce((n, s) => n + s.value, 0)
  if (!total) return null
  return (
    <div className="mb-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {segments.map(s => (
          <div key={s.key}
            title={`${s.name}: ${s.value.toLocaleString()} (${((s.value / total) * 100).toFixed(1)}%)`}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.fill }}
            className="min-w-[2px] transition-all" />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.fill }} />
            {s.name} · {s.value.toLocaleString()} ({((s.value / total) * 100).toFixed(1)}%)
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Orders() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData]       = useState({ items: [], total: 0, summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)

  const search   = searchParams.get('q') || ''
  const status   = searchParams.get('status') || ''
  const dateFrom = searchParams.get('from') || ''
  const dateTo   = searchParams.get('to') || ''
  const couponFilter = searchParams.get('coupon') || ''
  const tab      = searchParams.get('tab') || (couponFilter === 'yes' ? 'wc_affiliate' : DEFAULT_TAB)

  const setParam = (k, v) => {
    const p = new URLSearchParams(searchParams)
    v ? p.set(k, v) : p.delete(k)
    setSearchParams(p)
    setOffset(0)
  }

  const setTab = (key) => setParam('tab', key === DEFAULT_TAB ? '' : key)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = { number: PAGE_SIZE, offset, order: 'DESC' }
    if (search)   params.search = search
    if (status)   params.status = status
    if (dateFrom) params.date_from = dateFrom
    if (dateTo)   params.date_to = dateTo
    if (tab !== 'all') params.segment = tab
    if (couponFilter === 'yes' || couponFilter === 'true') params.coupon = 'yes'

    api.orders(params)
      .then(d => setData({
        items: (d.items || []).map(o => ({ ...o, segment: o.segment || inferSegment(o) })),
        total: d.total || 0,
        summary: d.summary,
      }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [search, status, dateFrom, dateTo, tab, couponFilter, offset])

  useEffect(() => { load() }, [load])

  const s = data.summary
  const apiHasSegments = s != null && (s.so != null || s.wc_affiliate != null)
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const headers = tableHeaders(tab)

  const segmentCounts = useMemo(() => {
    if (!s) return []
    return [
      { key: 'so',             name: SEGMENTS.so.label,             value: s.so || 0,             fill: SEGMENT_COLORS.so },
      { key: 'bb',             name: SEGMENTS.bb.label,             value: s.bb || 0,             fill: SEGMENT_COLORS.bb },
      { key: 'wc_affiliate',   name: 'Affiliate Coupon',            value: s.wc_affiliate || 0,   fill: SEGMENT_COLORS.wc_affiliate },
      { key: 'zoho_affiliate', name: 'Zoho affiliate coupon',       value: s.zoho_affiliate || 0, fill: SEGMENT_COLORS.zoho_affiliate },
      { key: 'other',          name: 'Other',                         value: s.other || 0,          fill: SEGMENT_COLORS.other },
    ].filter(x => x.value > 0)
  }, [s])

  const chartData = useMemo(() =>
    segmentCounts.map(x => ({ name: x.name, count: x.value, fill: x.fill })),
  [segmentCounts])

  const tabs = [
    { key: 'so',               n: s?.so },
    { key: 'bb',               n: s?.bb },
    { key: 'wc_affiliate',     n: s?.wc_affiliate },
    { key: 'zoho_affiliate',   n: s?.zoho_affiliate, hide: !s?.zoho_affiliate },
    { key: 'affiliate_coupon', n: s?.affiliate_coupon },
    { key: 'all',              n: segmentCounts.reduce((n, x) => n + x.value, 0) || s?.filtered_orders },
  ].filter(t => !t.hide)

  const exportRows = data.items.map(o => ({ ...o, segment: inferSegment(o), affiliate_source: inferSource(o) }))

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="SO · BB web · Affiliate Coupon (WC linked) · Zoho affiliate coupon"
        actions={
          <ExportButtons baseName={`orders-${tab}`} sheetName="Orders" columns={EXPORT_COLUMNS} rows={exportRows} />
        }
      />

      {error && <ErrorMsg error={error} />}

      {!apiHasSegments && !loading && (
        <div className="mx-6 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Segment counts need an API update on Render. Tabs and charts will work fully after the backend deploys.
        </div>
      )}

      {s && segmentCounts.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 mb-4">
            <SegmentCard label="SO orders" value={s.so?.toLocaleString()} sub="B2B / quote"
              color="text-slate-700" active={tab === 'so'} onClick={() => setTab('so')} />
            <SegmentCard label="BB orders" value={s.bb?.toLocaleString()} sub="Web store"
              color="text-blue-600" active={tab === 'bb'} onClick={() => setTab('bb')} />
            <SegmentCard label="Affiliate Coupon" value={s.wc_affiliate?.toLocaleString()}
              sub="WC + AffiliateWP linked" color="text-green-600"
              active={tab === 'wc_affiliate'} onClick={() => setTab('wc_affiliate')} />
            {(s.zoho_affiliate > 0) && (
              <SegmentCard label="Zoho affiliate coupon" value={s.zoho_affiliate?.toLocaleString()}
                sub="not in WooCommerce" color="text-purple-600"
                active={tab === 'zoho_affiliate'} onClick={() => setTab('zoho_affiliate')} />
            )}
            <SegmentCard label="Est. commission" value={fmt(s.est_commission)}
              sub="WC-linked coupons only" color="text-brand-orange"
              active={tab === 'wc_affiliate'} onClick={() => setTab('wc_affiliate')} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 px-6 mb-4">
            <div className="card lg:col-span-3 p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Orders by type</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => v.toLocaleString()} />
                  <Bar dataKey="count" name="Orders" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card lg:col-span-2 p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">Share of orders</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={chartData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                    label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={v => v.toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <SegmentBreakdownBar segments={segmentCounts} />
            </div>
          </div>
        </>
      )}

      <div className="mx-6 mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
        <span>
          Orders with an affiliate coupon are classified <strong>WC-linked first</strong> (WooCommerce + AffiliateWP).
          <strong> Affiliate Coupon</strong> = linked affiliates only — commission = subtotal × WC discount %.
          <strong> Zoho affiliate coupon</strong> = affiliate-type code on the order but not linked in WooCommerce (no commission).
          SO/BB tabs exclude affiliate-coupon orders.
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 mb-1">
        <div className="flex flex-wrap gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-navy-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {SEGMENTS[t.key].label}
              {t.n != null && <span className="ml-1.5 opacity-60">{t.n?.toLocaleString?.() ?? t.n}</span>}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input className="input pl-8 w-60" placeholder="Order #, customer, coupon…"
            defaultValue={search}
            onKeyDown={e => e.key === 'Enter' && setParam('q', e.target.value.trim())}
            onBlur={e => { if (e.target.value.trim() !== search) setParam('q', e.target.value.trim()) }} />
        </div>
      </div>
      <p className="px-6 mb-1 text-xs text-gray-500">{SEGMENTS[tab]?.short}</p>
      {s && tab !== 'all' && (
        <p className="px-6 mb-3 text-xs text-gray-400">
          Showing {data.total.toLocaleString()} {SEGMENTS[tab].label.toLowerCase()}
          {s.total_revenue != null && ` · ${fmt(s.total_revenue)} revenue in this view`}
        </p>
      )}

      <div className="px-6 mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">Status</span>
          <input className="input w-32" placeholder="e.g. closed" value={status}
            onChange={e => setParam('status', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">From</span>
          <input type="date" className="input" value={dateFrom}
            onChange={e => setParam('from', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">To</span>
          <input type="date" className="input" value={dateTo}
            onChange={e => setParam('to', e.target.value)} />
        </label>
      </div>

      <div className="px-6 pb-8">
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {headers.map((h, i) => (
                  <th key={i} className={`th ${
                    ['Subtotal', 'Total', 'Commission'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={headers.length}><Spinner /></td></tr>
                : data.items.length === 0
                  ? <tr><td colSpan={headers.length}><Empty label={`No ${SEGMENTS[tab]?.label?.toLowerCase() || 'orders'}`} /></td></tr>
                  : data.items.map(o => <OrderRow key={o.salesorder_id} o={o} tab={tab} />)
              }
            </tbody>
          </table>
        </div>

        {data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>Page {page} of {pages} · {data.total.toLocaleString()} orders</span>
            <div className="flex gap-2">
              <button className="btn-outline px-2 py-1" disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                <ChevronLeft size={16} />
              </button>
              <button className="btn-outline px-2 py-1" disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
