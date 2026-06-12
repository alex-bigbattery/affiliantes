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

/** Strip tags and decode common HTML entities from WC/AffiliateWP strings. */
function plainText(raw) {
  let s = String(raw || '').replace(/<[^>]+>/g, ' ')
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

const SEGMENTS = {
  so:               { label: 'SO orders',              short: 'Zoho B2B / quote orders (SO- prefix), no affiliate coupon' },
  bb:               { label: 'BB orders',              short: 'WooCommerce web orders (BB prefix) — includes affiliate-coupon orders' },
  wc_affiliate:     { label: 'Affiliate Coupon',       short: 'Affiliate coupon linked in WooCommerce → AffiliateWP (commission applies)' },
  zoho_affiliate:   { label: 'Zoho affiliate coupon',  short: 'Affiliate-type coupon on Zoho orders, not linked in WooCommerce' },
  affiliate_coupon: { label: 'All affiliate coupons',  short: 'WC-linked first, then Zoho-only affiliate coupons' },
  wc_only:          { label: 'WC only (not in Zoho)', short: 'WooCommerce BB orders not yet in Zoho sales_orders — additive, does not change Zoho tabs' },
  all:              { label: 'All (Zoho)',            short: 'Every Zoho sales order (Aug 2025+)' },
}

const SEGMENT_COLORS = {
  so:               '#475569',
  bb:               '#2563eb',
  wc_affiliate:     '#16a34a',
  zoho_affiliate:   '#9333ea',
  affiliate_coupon: '#059669',
  wc_only:          '#0ea5e9',
  other:            '#9ca3af',
}

const SEGMENT_BADGE = {
  so:               'bg-slate-100 text-slate-700',
  bb:               'bg-blue-100 text-blue-800',
  wc_affiliate:     'bg-green-100 text-green-800',
  zoho_affiliate:   'bg-purple-100 text-purple-800',
  affiliate_coupon: 'bg-emerald-100 text-emerald-800',
  wc_only:          'bg-sky-100 text-sky-800',
  other:            'bg-gray-100 text-gray-600',
}

const ROW_ACCENT = {
  so:               'border-l-4 border-l-slate-400',
  bb:               'border-l-4 border-l-blue-500',
  wc_affiliate:     'border-l-4 border-l-green-500',
  zoho_affiliate:   'border-l-4 border-l-purple-500',
  affiliate_coupon: 'border-l-4 border-l-emerald-500',
  wc_only:          'border-l-4 border-l-sky-500',
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
  { header: 'Affiliate email', value: o => o.affiliate_email || '' },
  { header: 'AWP ID',          value: o => o.affiliate_id ?? '' },
  { header: 'Net',             value: o => Number(o.sub_total || 0) },
  { header: 'Revenue',         value: o => Number(o.total || 0) },
  { header: 'Net Sales',       value: o => o.net_sales != null ? Number(o.net_sales) : '' },
  { header: 'Est. commission', value: o => o.est_commission != null ? Number(o.est_commission) : '' },
  { header: 'Refunded',        value: o => o.is_refunded ? 'Yes' : 'No' },
  { header: 'Refund amount',   value: o => o.refund_amount != null ? Number(o.refund_amount) : '' },
  { header: 'Status',          value: o => o.status || '' },
  { header: 'Reference',       value: o => o.reference_number || '' },
]

const RIGHT_HEADERS = ['Net', 'Revenue', 'Net Sales', 'Commission', 'Items sold']

/** Normalize URL/date-picker values to YYYY-MM-DD (handles US M/D/YYYY in bookmarks). */
function toIsoDate(s) {
  if (!s) return ''
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const isoPrefix = t.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoPrefix) return isoPrefix[1]
  return ''
}

/** YYYY-MM → first/last calendar day of that month. */
function monthBounds(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null
  const [y, m] = ym.split('-').map(Number)
  const from = `${ym}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${ym}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function inferMonthFromRange(from, to) {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !from.endsWith('-01')) return ''
  const ym = from.slice(0, 7)
  const bounds = monthBounds(ym)
  return bounds?.from === from && bounds?.to === to ? ym : ''
}

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

function AffiliateCell({ o, showEmail = true }) {
  return (
    <>
      <td className="td text-sm max-w-[140px] truncate" title={o.affiliate_name}>
        {o.affiliate_name || <span className="text-gray-300">—</span>}
      </td>
      {showEmail && (
        <td className="td text-sm max-w-[180px] truncate text-gray-600" title={o.affiliate_email}>
          {o.affiliate_email || <span className="text-gray-300">—</span>}
        </td>
      )}
    </>
  )
}

function CustomerCell({ o }) {
  return (
    <td className="td text-sm max-w-[160px] truncate" title={o.customer_name}>
      {o.customer_name || '—'}
    </td>
  )
}

function CustomerTypeCell({ o }) {
  return (
    <td className="td text-sm text-gray-600 capitalize">{o.customer_type || '—'}</td>
  )
}

function AwpIdCell({ o }) {
  return (
    <td className="td text-sm font-mono text-gray-500">{o.affiliate_id ?? '—'}</td>
  )
}

function CustomerTailCells({ o, showAwpId = false }) {
  return (
    <>
      <CustomerCell o={o} />
      <CustomerTypeCell o={o} />
      {showAwpId && <AwpIdCell o={o} />}
    </>
  )
}

function WcUpdateCell({ o }) {
  if (!o.wc_order_id) {
    return <td className="td sticky-col-right text-center"><span className="text-gray-300">—</span></td>
  }
  const adminUrl = `${WC_ADMIN_ORDER}${o.wc_order_id}`
  return (
    <td className="td sticky-col-right text-center whitespace-nowrap">
      <a href={adminUrl} target="_blank" rel="noopener noreferrer"
        className="btn-primary inline-block px-2.5 py-1 text-xs font-medium"
        title="Abrir en WooCommerce wp-admin → click Update (crea referral AffiliateWP)">
        Abrir WC
      </a>
      <div className="text-[10px] text-gray-400 mt-0.5">luego Update</div>
    </td>
  )
}

function RefundCell({ o }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState(null)
  const [notesError, setNotesError] = useState(null)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const loadNotes = async () => {
    if (!o.wc_order_id || loadingNotes) return
    setLoadingNotes(true)
    setNotesError(null)
    try {
      const res = await api.orderWcNotes(o.wc_order_id)
      setNotes(res)
    } catch (e) {
      setNotes(null)
      setNotesError(e.message || 'Could not load order notes')
    } finally {
      setLoadingNotes(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) {
      setNotes(null)
      loadNotes()
    }
  }

  const details = o.refund_details || []
  const referrals = o.affiliate_referrals || []
  const noteItems = notes?.notes || []

  return (
    <td className="td text-center whitespace-nowrap">
      <div ref={wrapRef} className="relative inline-flex items-center justify-center gap-1">
        {o.is_refunded
          ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Yes</span>
          : <span className="text-xs text-gray-400">No</span>}
        <button type="button" onClick={toggle}
          className="p-0.5 rounded-full text-gray-400 hover:text-navy-700 hover:bg-gray-100"
          title="Refund details & WooCommerce order notes"
          aria-label="Refund details">
          <Info size={14} />
        </button>
        {open && (
          <div className="order-history-popover absolute right-0 top-full z-50 mt-1 w-80 sm:w-96 max-w-[min(24rem,calc(100vw-1.5rem))] max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl text-left p-3 text-xs text-gray-700">
            <p className="font-semibold text-sm text-navy-900 mb-2">Refund & order history</p>

            {o.is_refunded ? (
              <div className="mb-3">
                <p className="font-medium text-red-700 mb-1">Refunded order</p>
                {o.refund_amount != null && (
                  <p className="text-gray-600">Total refunded: <span className="font-semibold">{fmt(o.refund_amount)}</span></p>
                )}
                {details.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {details.map((d, i) => (
                      <li key={d.id || i} className="text-gray-600">
                        {fmt(d.amount)}{d.reason ? ` — ${d.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mb-3 text-gray-500">No refund detected in WooCommerce or AffiliateWP.</p>
            )}

            {referrals.length > 0 && (
              <div className="mb-3 border-t border-gray-100 pt-2">
                <p className="font-medium text-gray-800 mb-1">Affiliate referrals</p>
                <ul className="space-y-1.5">
                  {referrals.map(r => (
                    <li key={r.referral_id} className="rounded bg-purple-50 px-2 py-1.5 text-purple-900">
                      <div className="whitespace-normal break-words [overflow-wrap:anywhere] [word-break:break-word]">
                        <span className="font-mono">#{r.referral_id}</span>
                        {r.amount != null && <> · {fmt(r.amount)}</>}
                        {r.status && <span className="capitalize"> · {r.status}</span>}
                        {r.description && <div className="mt-0.5 text-purple-800">{plainText(r.description)}</div>}
                        {r.date && <div className="text-[10px] text-purple-600/80 mt-0.5">{fmtDateTime(r.date)}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t border-gray-100 pt-2">
              <p className="font-medium text-gray-800 mb-1">WooCommerce order notes</p>
              {!o.wc_order_id && <p className="text-gray-400">No WC order linked.</p>}
              {o.wc_order_id && loadingNotes && <p className="text-gray-400">Loading notes…</p>}
              {o.wc_order_id && notesError && <p className="text-red-600">{notesError}</p>}
              {o.wc_order_id && notes && !notes.configured && (
                <p className="text-gray-500">
                  WooCommerce REST API keys missing on the <strong>API server</strong> handling this request
                  (not the browser). On Render they are set — restart local <code className="bg-gray-100 px-1 rounded">npm run dev</code> after
                  adding <code className="bg-gray-100 px-1 rounded">WOO_CONSUMER_KEY</code> / <code className="bg-gray-100 px-1 rounded">WOO_CONSUMER_SECRET</code> to
                  <code className="bg-gray-100 px-1 rounded"> affiliate-dashboard/.env</code>, or set
                  <code className="bg-gray-100 px-1 rounded"> VITE_API_URL</code> to the Render API URL.
                </p>
              )}
              {noteItems.length > 0 ? (
                <ul className="space-y-2">
                  {noteItems.map(n => (
                    <li key={n.id} className="rounded bg-violet-50 px-2 py-1.5">
                      <div className="text-gray-800 whitespace-normal break-words [overflow-wrap:anywhere] [word-break:break-word]">{plainText(n.text)}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{fmtDateTime(n.date)}</div>
                    </li>
                  ))}
                </ul>
              ) : o.wc_order_id && notes?.configured && !loadingNotes ? (
                <p className="text-gray-400">No notes on this order.</p>
              ) : null}
            </div>
          </div>
        )}
      </div>
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
    <div ref={wrapRef} className="relative z-50 w-64">
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400 pointer-events-none" />
        <input
          className="input pl-8 pr-8 w-full bg-white"
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
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-xl text-sm">
          <li>
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-gray-50 text-gray-500 bg-white"
              onClick={() => pick('')}>All affiliates</button>
          </li>
          {filtered.length === 0
            ? <li className="px-3 py-2 text-gray-400 bg-white">No matches</li>
            : filtered.map(a => (
              <li key={a.affiliate_id} className="bg-white">
                <button type="button"
                  className={`w-full px-3 py-1.5 text-left hover:bg-gray-50 truncate bg-white ${String(a.affiliate_id) === value ? 'bg-navy-50 text-navy-800' : ''}`}
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

function ProductCells({ o }) {
  return (
    <>
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

function TableFooter({ headers, summary, orderCount }) {
  const netIdx = headers.indexOf('Net')
  if (netIdx < 0 || !summary) return null

  const showCommission = headers.includes('Commission')
  const moneyCols = showCommission ? 4 : 3
  const tailCols = headers.length - netIdx - moneyCols

  return (
    <tfoot>
      <tr className="bg-slate-50 border-t-2 border-slate-300">
        <td colSpan={netIdx} className="td text-right font-semibold text-sm text-gray-700">
          Total{orderCount != null ? ` (${orderCount.toLocaleString()} orders)` : ''}
        </td>
        <td className="td text-right text-sm font-semibold">{fmt(summary.total_subtotal)}</td>
        <td className="td text-right text-sm font-semibold">{fmt(summary.total_revenue)}</td>
        <td className="td text-right text-sm font-semibold">{fmt(summary.total_net_sales)}</td>
        {showCommission && (
          <td className="td text-right text-sm font-bold text-brand-orange">{fmt(summary.est_commission)}</td>
        )}
        {tailCols > 0 && <td colSpan={tailCols} className="td" />}
      </tr>
    </tfoot>
  )
}

function tableHeaders(tab) {
  const updateCol = 'WC Admin'
  const products = ['Product(s)', 'Items sold']
  const money = (commission = false) => commission
    ? ['Net', 'Revenue', 'Net Sales', 'Commission']
    : ['Net', 'Revenue', 'Net Sales']

  const affiliate = ['Affiliate', 'Email']
  const rowTail = (withAwp = false) => withAwp
    ? ['Customer', 'Customer type', 'AWP ID', 'WC ID']
    : ['Customer', 'Customer type', 'WC ID']

  if (tab === 'wc_affiliate') {
    return ['Order #', 'Date', ...products, 'Coupon', ...affiliate, ...money(true), 'Refund', 'Status', ...rowTail(true), updateCol]
  }
  if (tab === 'zoho_affiliate') {
    return ['Order #', 'Date', ...products, 'Coupon', ...affiliate, ...money(), 'Refund', 'Status', ...rowTail(true), updateCol]
  }
  if (tab === 'affiliate_coupon') {
    return ['Order #', 'Source', 'Date', ...products, 'Coupon', ...affiliate, ...money(true), 'Refund', 'Status', ...rowTail(true), updateCol]
  }
  if (tab === 'bb' || tab === 'so' || tab === 'wc_only') {
    return ['Order #', 'Date', ...products, 'Coupon', ...affiliate, ...money(), 'Refund', 'Status', 'Reference', ...rowTail(false), updateCol]
  }
  return ['Order #', 'Type', 'Date', ...products, 'Coupon', ...affiliate, ...money(true), 'Refund', 'Status', ...rowTail(false), updateCol]
}

function RowTailCells({ o, showAwpId = false }) {
  return (
    <>
      <CustomerTailCells o={o} showAwpId={showAwpId} />
      <WcIdCell o={o} />
    </>
  )
}
function orderNumCell(o) {
  return (
    <td className="td sticky-col-left font-mono text-sm font-medium whitespace-nowrap">
      {o.salesorder_number || o.salesorder_id}
    </td>
  )
}

function OrderRow({ o, tab }) {
  const seg = inferSegment(o)
  const source = inferSource(o)
  const accent = ROW_ACCENT[seg] || ROW_ACCENT.other

  if (tab === 'wc_affiliate') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT.wc_affiliate}`}>
        {orderNumCell(o)}
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <ProductCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <AffiliateCell o={o} />
        <MoneyCells o={o} showCommission />
        <RefundCell o={o} />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <RowTailCells o={o} showAwpId />
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  if (tab === 'zoho_affiliate') {
    return (
      <tr className={`tr-hover ${ROW_ACCENT.zoho_affiliate}`}>
        {orderNumCell(o)}
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <ProductCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <AffiliateCell o={o} />
        <MoneyCells o={o} />
        <RefundCell o={o} />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <RowTailCells o={o} showAwpId />
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  if (tab === 'affiliate_coupon') {
    return (
      <tr className={`tr-hover ${accent}`}>
        {orderNumCell(o)}
        <td className="td"><SourceBadge source={source} /></td>
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <ProductCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code}</td>
        <AffiliateCell o={o} />
        <MoneyCells o={o} showCommission />
        <RefundCell o={o} />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <RowTailCells o={o} showAwpId />
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  if (tab === 'bb' || tab === 'so' || tab === 'wc_only') {
    const accent = tab === 'wc_only' ? ROW_ACCENT.wc_only : ROW_ACCENT[tab]
    return (
      <tr className={`tr-hover ${accent}`}>
        {orderNumCell(o)}
        <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
        <ProductCells o={o} />
        <td className="td font-mono text-sm">{o.coupon_code || <span className="text-gray-300">—</span>}</td>
        <AffiliateCell o={o} />
        <MoneyCells o={o} />
        <RefundCell o={o} />
        <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
        <td className="td text-xs text-gray-500 font-mono">{tab === 'wc_only' ? 'WC only' : (o.reference_number || '—')}</td>
        <RowTailCells o={o} />
        <WcUpdateCell o={o} />
      </tr>
    )
  }

  return (
    <tr className={`tr-hover ${accent}`}>
      {orderNumCell(o)}
      <td className="td"><SegmentBadge segment={seg} /></td>
      <td className="td text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(o.order_datetime || o.order_date)}</td>
      <ProductCells o={o} />
      <td className="td font-mono text-sm">{o.coupon_code || <span className="text-gray-300">—</span>}</td>
      <AffiliateCell o={o} />
      <MoneyCells o={o} showCommission />
      <RefundCell o={o} />
      <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
      <RowTailCells o={o} />
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
  const dateFrom = toIsoDate(searchParams.get('from') || '')
  const dateTo   = toIsoDate(searchParams.get('to') || '')
  const monthParam = searchParams.get('month') || ''
  const monthFilter = useMemo(() => {
    if (/^\d{4}-\d{2}$/.test(monthParam)) return monthParam
    return inferMonthFromRange(dateFrom, dateTo)
  }, [monthParam, dateFrom, dateTo])
  const couponFilter = searchParams.get('coupon') || ''
  const affiliateId = searchParams.get('affiliate') || ''
  const tab      = searchParams.get('tab') || (couponFilter === 'yes' ? 'wc_affiliate' : DEFAULT_TAB)

  const setParam = (k, v) => {
    const p = new URLSearchParams(searchParams)
    v ? p.set(k, v) : p.delete(k)
    setSearchParams(p)
    setOffset(0)
  }

  const setMonthFilter = (ym) => {
    const p = new URLSearchParams(searchParams)
    if (ym) {
      const bounds = monthBounds(ym)
      if (!bounds) return
      p.set('month', ym)
      p.set('from', bounds.from)
      p.set('to', bounds.to)
    } else {
      p.delete('month')
      p.delete('from')
      p.delete('to')
    }
    setSearchParams(p)
    setOffset(0)
  }

  const setDateFrom = (v) => {
    const p = new URLSearchParams(searchParams)
    v ? p.set('from', v) : p.delete('from')
    p.delete('month')
    setSearchParams(p)
    setOffset(0)
  }

  const setDateTo = (v) => {
    const p = new URLSearchParams(searchParams)
    v ? p.set('to', v) : p.delete('to')
    p.delete('month')
    setSearchParams(p)
    setOffset(0)
  }

  const setTab = (key) => setParam('tab', key === DEFAULT_TAB ? '' : key)

  const hasActiveFilters = !!(search || status || dateFrom || dateTo || monthFilter || affiliateId)
  const clearFilters = () => {
    const p = new URLSearchParams(searchParams)
    ;['q', 'status', 'from', 'to', 'month', 'affiliate'].forEach(k => p.delete(k))
    setSearchParams(p)
    setOffset(0)
  }

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = { number: PAGE_SIZE, offset, order: 'DESC' }
    if (search)   params.search = search
    if (status)   params.status = status
    if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) params.date_from = dateFrom
    if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) params.date_to = dateTo
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
    const rawFrom = searchParams.get('from') || ''
    const rawTo = searchParams.get('to') || ''
    const isoFrom = toIsoDate(rawFrom)
    const isoTo = toIsoDate(rawTo)
    const p = new URLSearchParams(searchParams)
    let changed = false
    if (rawFrom && isoFrom !== rawFrom) {
      if (isoFrom) p.set('from', isoFrom); else p.delete('from')
      changed = true
    }
    if (rawTo && isoTo !== rawTo) {
      if (isoTo) p.set('to', isoTo); else p.delete('to')
      changed = true
    }
    if (changed) setSearchParams(p, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    api.affiliates({ number: 500 }).then(d => setAffiliates(Array.isArray(d) ? d : [])).catch(() => {})
    api.orderStatuses().then(d => setStatuses(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const selectedAffiliate = useMemo(
    () => affiliates.find(a => String(a.affiliate_id) === affiliateId),
    [affiliates, affiliateId],
  )
  const showCommissionTab = tab === 'wc_affiliate' || tab === 'affiliate_coupon' || tab === 'all'

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
    { key: 'bb',               n: s?.bb_all ?? s?.bb },
    { key: 'wc_affiliate',     n: s?.wc_affiliate },
    { key: 'zoho_affiliate',   n: s?.zoho_affiliate, hide: !s?.zoho_affiliate },
    { key: 'affiliate_coupon', n: s?.affiliate_coupon },
    { key: 'wc_only',          n: s?.wc_only, hide: !s?.wc_only },
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
            <SegmentCard label="BB orders" value={(s.bb_all ?? s.bb)?.toLocaleString()} sub="Web store (all)"
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
          <strong> Affiliate Coupon</strong> = linked affiliates only — commission = Net Sales (excl. shipping) × WC discount %.
          <strong> Zoho affiliate coupon</strong> = affiliate-type code on the order but not linked in WooCommerce (no commission).
          SO/BB tabs exclude affiliate-coupon orders.
          Void, cancelled, and refunded orders are hidden by default (pick that status in the filter to view them).
          <strong> WC only (not in Zoho)</strong> = BB orders in WooCommerce that are not in Zoho yet — does not change Zoho tab counts.
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

      <div className="relative z-40 px-6 mb-4 flex flex-wrap items-end gap-3">
        <label className="block relative">
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
          <span className="text-xs text-gray-500 mb-1 block">Month</span>
          <input type="month" className="input w-40" value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">From</span>
          <input type="date" className="input" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 mb-1 block">To</span>
          <input type="date" className="input" value={dateTo}
            onChange={e => setDateTo(e.target.value)} />
        </label>
        {hasActiveFilters && (
          <button type="button" onClick={clearFilters}
            className="btn-outline text-sm py-2 px-3 self-end">
            Clear filters
          </button>
        )}
      </div>

      <div className="px-6 pb-8">
        <div className="card orders-table-scroll">
          <table className="orders-table">
            <thead>
              <tr className="border-b">
                {headers.map((h, i) => (
                  <th key={i} className={`th ${
                    i === 0 ? 'sticky-corner min-w-[7rem]' : i === headers.length - 1 ? 'sticky-corner-right min-w-[6.5rem]' : 'sticky-thead'
                  } ${
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
            {!loading && data.items.length > 0 && s && (
              <TableFooter headers={headers} summary={s} orderCount={s.filtered_orders} />
            )}
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
