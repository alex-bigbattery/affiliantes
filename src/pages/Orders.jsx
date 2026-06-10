import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, Info, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { api, fmt, fmtDateTime } from '../api'
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
  { header: 'Date',            value: o => o.order_datetime || o.order_date || '' },
  { header: 'Customer',        value: o => o.customer_name || '' },
  { header: 'Customer type',   value: o => o.customer_type || '' },
  { header: 'Coupon',          value: o => o.coupon_code || '' },
  { header: 'Product(s)',      value: o => o.products_text || '' },
  { header: 'Items sold',      value: o => o.items_sold ?? '' },
  { header: 'Affiliate',       value: o => o.affiliate_name || '' },
  { header: 'AWP ID',          value: o => o.affiliate_id ?? '' },
  { header: 'Net',             value: o => Number(o.sub_total || 0) },
  { header: 'Revenue',         value: o => Number(o.total || 0) },
  { header: 'Net Sales',       value: o => o.net_sales != null ? Number(o.net_sales) : '' },
  { header: 'Est. commission', value: o => o.est_commission != null ? Number(o.est_commission) : '' },
  { header: 'Status',          value: o => o.status || '' },
  { header: 'Reference',       value: o => o.reference_number || '' },
]

const RIGHT_HEADERS = ['Net', 'Revenue', 'Net Sales', 'Commission', 'Items sold']

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

function WcIdCell({ o }) {
  return (
    <td className="td font-mono text-sm">
      <WcOrderId id={o.wc_order_id} />
    </td>
  )
}

function AffiliateCell({ o, showId = false }) {
  return (
    <>
      <td className="td text-sm max-w-[140px] truncate" title={o.affiliate_name}>
        {o.affiliate_name || <span className="text-gray-300">—</span>}
      </td>
      {showId && (
        <td className="td text-sm font-mono text-gray-500">{o.affiliate_id ?? '—'}</td>
      )}
    </>
  )
}

function WcUpdateCell({ o }) {
  if (!o.wc_order_id) {
    return <td className="td text-center"><span className="text-gray-300">—</span></td>
  }
  const adminUrl = `${WC_ADMIN_ORDER}${o.wc_order_id}`
  return (
    <td className="td text-center whitespace-nowrap">
      <a href={adminUrl} target="_blank" rel="noopener noreferrer"
        className="btn-primary inline-block px-2.5 py-1 text-xs font-medium"
        title="Abrir en WooCommerce wp-admin → click Update (crea referral AffiliateWP)">
        Abrir WC
      </a>
      <div className="text-[10px] text-gray-400 mt-0.5">luego Update</div>
    </td>
  )
}

function affiliateLabel(a) {
  return `#${a.affiliate_id} — ${a.display_name || a.username || a.payment_email || `user ${a.user_id}`}`
}

function SearchableAffiliateSelect({ affiliates, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef(null)

  const selected = affiliates.find(a => String(a.affiliate_id) === value)
  const display = selected ? affiliateLabel(selected) : ''

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return affiliates
    return affiliates.filter(a =>
      String(a.affiliate_id).includes(qq)
      || (a.display_name || '').toLowerCase().includes(qq)
      || (a.username || '').toLowerCase().includes(qq)
      || (a.payment_email || '').toLowerCase().includes(qq))
  }, [affiliates, q])

  useEffect(() => {
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (!open) setQ(selected ? display : '')
  }, [value, open, display, selected])

  const pick = (id) => {
    onChange(id ? String(id) : '')
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={wrapRef} className="relative w-64">
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400 pointer-events-none" />
        <input
          className="input pl-8 pr-8 w-full"
          placeholder="Search affiliate…"
          value={open ? q : display}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setQ(display) }}
        />
        {value && (
          <button type="button" className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 text-xs"
            onClick={() => pick('')} title="Clear">✕</button>
        )}
      </div>
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg text-sm">
          <li>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-gray-50 text-gray-500"
              onClick={() => pick('')}>All affiliates</button>
          </li>
          {filtered.length === 0
            ? <li className="px-3 py-2 text-gray-400">No matches</li>
            : filtered.map(a => (
              <li key={a.affiliate_id}>
                <button type="button"
                  className={`w-full px-3 py-1.5 text-left hover:bg-gray-50 truncate ${String(a.affiliate_id) === value ? 'bg-navy-50 text-navy-800' : ''}`}
                  onClick={() => pick(a.affiliate_id)}>
                  {affiliateLabel(a)}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function DetailCells({ o }) {
  return (
    <>
      <td className="td text-sm text-gray-600 capitalize">{o.customer_type || '—'}</td>
      <td className="td text-sm max-w-[280px] truncate" title={o.products_text}>{o.products_text || '—'}</td>
      <td className="td text-right text-sm">{o.items_sold ?? '—'}</td>
    </>
  )
}

function MoneyCells({ o, showCommission = false }) {
  const commission = o.est_commission != null
    ? <span className="font-semibold text-brand-orange">{fmt(o.est_commission)}</span>
    : <span className="text-gray-300">—</span>
  return (
    <>
      <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
      <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
      <td className="td text-right text-sm">{o.net_sales != null ? fmt(o.net_sales) : '—'}</td>
      {showCommission && <td className="td text-right text-sm">{commission}</td>}
    </>
  )
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
  const updateCol = 'WC Admin'
  const detail = ['Customer type', 'Product(s)', 'Items sold']
  const money = (commission = false) => commission
    ? ['Net', 'Revenue', 'Net Sales', 'Commission']
    : ['Net', 'Revenue', 'Net Sales']

  if (tab === 'wc_affiliate') {
    return ['Order #', 'WC ID', 'Date', 'Customer', ...detail, 'Coupon', 'Affiliate', 'AWP ID', ...money(true), 'Status', updateCol]
  }
  if (tab === 'zoho_affiliate') {
    return ['Order #', 'WC ID', 'Date', 'Customer', ...detail, 'Coupon', 'Affiliate', 'AWP ID', ...money(), 'Status', updateCol]
  }
  if (tab === 'affiliate_coupon') {
    return ['Order #', 'WC ID', 'Source', 'Date', 'Customer', ...detail, 'Coupon', 'Affiliate', 'AWP ID', ...money(true), 'Status', updateCol]
  }
  if (tab === 'bb' || tab === 'so') {
    return ['Order #', 'WC ID', 'Date', 'Customer', ...detail, 'Coupon', 'Affiliate', ...money(), 'Status', 'Reference', updateCol]
  }
  return ['Order #', 'WC ID', 'Type', 'Date', 'Customer', ...detail, 'Coupon', 'Affiliate', ...money(true), 'Status', updateCol]
}

function OrderRow({ o, tab }) {
  const seg = inferSegment(o)
  const source = inferSource(o)
  const accent = ROW_ACCENT[seg] || ROW_ACCENT.other

  if (tab === 'wc_affiliate') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT.wc_affiliate}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        <WcIdCell o={o} />
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <DetailCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <AffiliateCell o={o} showId />
        <MoneyCells o={o} showCommission />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  if (tab === 'zoho_affiliate') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT.zoho_affiliate}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        <WcIdCell o={o} />
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <DetailCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <AffiliateCell o={o} showId />
        <MoneyCells o={o} />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  if (tab === 'affiliate_coupon') {
    return (
      <tr className={`tr-hover ${accent}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        <WcIdCell o={o} />
        <td className="td"><SourceBadge source={source} /></td>
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <DetailCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <AffiliateCell o={o} showId />
        <MoneyCells o={o} showCommission />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  if (tab === 'bb' || tab === 'so') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT[tab]}`}>
        <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
        <WcIdCell o={o} />
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
        <DetailCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code || <span className="text-gray-300">—</span>}</td>
        <AffiliateCell o={o} />
        <MoneyCells o={o} />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <td className="td text-xs text-gray-500 font-mono">{o.reference_number || '—'}</td>
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  return (
    <tr className={`tr-hover ${accent}`}>
      <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
      <WcIdCell o={o} />
      <td className="td"><SegmentBadge segment={seg} /></td>
      <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
      <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
      <DetailCells o={o} />
      <td className="td font-mono text-sm">{o.coupon_code || <span className="text-gray-300">—</span>}</td>
      <AffiliateCell o={o} />
      <MoneyCells o={o} showCommission />
      <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
      <WcUpdateCell o={o} />
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
  const [affiliates, setAffiliates] = useState([])
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)
  const search   = searchParams.get('q') || ''
  const status   = searchParams.get('status') || ''
  const dateFrom = searchParams.get('from') || ''
  const dateTo   = searchParams.get('to') || ''
  const couponFilter = searchParams.get('coupon') || ''
  const affiliateId = searchParams.get('affiliate') || ''
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
    if (affiliateId) params.affiliate_id = affiliateId

    api.orders(params)
      .then(d => setData({
        items: (d.items || []).map(o => ({ ...o, segment: o.segment || inferSegment(o) })),
        total: d.total || 0,
        summary: d.summary,
      }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [search, status, dateFrom, dateTo, tab, couponFilter, affiliateId, offset])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.affiliates({ number: 500 }).then(d => setAffiliates(Array.isArray(d) ? d : [])).catch(() => {})
    api.orderStatuses().then(d => setStatuses(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const selectedAffiliate = useMemo(
    () => affiliates.find(a => String(a.affiliate_id) === affiliateId),
    [affiliates, affiliateId],
  )
  const showCommissionTab = tab === 'wc_affiliate' || tab === 'affiliate_coupon' || tab === 'all'

  const showWcBulk = tab === 'wc_affiliate' || tab === 'affiliate_coupon'

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
          <div className="flex flex-wrap items-center gap-2">
            {showWcBulk && (
              <span className="text-xs text-gray-500 max-w-xs" title="Plan B — corre en tu PC">
                Auto: <code className="bg-gray-100 px-1 rounded">npm run wc:admin-update</code>
              </span>
            )}
            <ExportButtons baseName={`orders-${tab}`} sheetName="Orders" columns={EXPORT_COLUMNS} rows={exportRows} />
          </div>
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
          La API REST no crea el <strong>referral</strong> en AffiliateWP — usa <strong>Abrir WC</strong> y pulsa Update,
          o el script local <code className="bg-blue-100 px-1 rounded">npm run wc:admin-update</code>.
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

      {affiliateId && s && (
        <div className="mx-6 mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">
            Totals — {selectedAffiliate ? affiliateLabel(selectedAffiliate) : `Affiliate #${affiliateId}`}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Orders" value={s.filtered_orders?.toLocaleString()} color="text-navy-700" />
            <StatCard label="Items sold" value={s.total_items_sold?.toLocaleString()} color="text-slate-600" />
            <StatCard label="Net" value={fmt(s.total_subtotal)} sub="subtotal" color="text-slate-700" />
            <StatCard label="Revenue" value={fmt(s.total_revenue)} sub="order total" color="text-blue-600" />
            <StatCard label="Net Sales" value={fmt(s.total_net_sales)} sub="product lines" color="text-slate-600" />
            {showCommissionTab && (
              <StatCard label="Est. commission" value={fmt(s.est_commission)} color="text-brand-orange" />
            )}
          </div>
        </div>
      )}

      <div className="px-6 mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">Affiliate</span>
          <SearchableAffiliateSelect affiliates={affiliates} value={affiliateId}
            onChange={v => setParam('affiliate', v)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">Status</span>
          <select className="select w-40" value={status}
            onChange={e => setParam('status', e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map(st => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
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
                    RIGHT_HEADERS.includes(h) ? 'text-right' : h === 'WC Admin' ? 'text-center' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={headers.length}><Spinner /></td></tr>
                : data.items.length === 0
                  ? <tr><td colSpan={headers.length}><Empty label={`No ${SEGMENTS[tab]?.label?.toLowerCase() || 'orders'}`} /></td></tr>
                  : data.items.map(o => (
                    <OrderRow key={o.salesorder_id} o={o} tab={tab} />
                  ))
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
