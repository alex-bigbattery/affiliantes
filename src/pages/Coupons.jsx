import { useState, useEffect, useMemo } from 'react'
import { Info, Pencil, Search } from 'lucide-react'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty, Modal, StatCard } from '../components/Layout'
import ExportButtons from '../components/ExportButtons'

const SEGMENTS = {
  wc_linked:   { label: 'WC + AffiliateWP', short: 'Linked affiliate coupons in WooCommerce with an AffiliateWP owner' },
  zoho_only:   { label: 'Zoho only',        short: 'Used on Zoho orders but not in the WooCommerce catalog' },
  wc_unlinked: { label: 'WC unlinked',      short: 'Affiliate-type WC coupons with no AffiliateWP owner assigned' },
  wc_promo:    { label: 'WC promos',        short: 'Store promos in WooCommerce (not affiliate commissions)' },
  all:         { label: 'All',              short: 'Every coupon code across both sources' },
}

const EXPORT_COLUMNS = [
  { header: 'Segment',         value: c => c.segment || '' },
  { header: 'Coupon',          value: c => c.coupon_code },
  { header: 'WC discount',     value: c => formatDiscount(c) },
  { header: 'Affiliate',       value: c => c.affiliate_name || '' },
  { header: 'AffiliateWP ID',  value: c => c.affiliate_id ?? '' },
  { header: 'Zoho orders',     value: c => Number(c.orders || 0) },
  { header: 'Revenue',         value: c => Number(c.revenue || 0) },
  { header: 'Subtotal',        value: c => Number(c.subtotal || 0) },
  { header: 'Est. commission', value: c => c.est_commission != null ? Number(c.est_commission) : '' },
  { header: 'Last order',      value: c => c.last_order ? String(c.last_order).slice(0, 10) : '' },
]

function formatDiscount(c) {
  if (c.discount_amount == null) return ''
  const amt = Number(c.discount_amount)
  if (c.discount_type === 'percent') return `${amt}%`
  if (c.discount_type === 'fixed_cart' || c.discount_type === 'fixed_product') return `$${amt}`
  return String(amt)
}

function SegmentBadge({ segment }) {
  const cls = {
    wc_linked:   'bg-green-100 text-green-800',
    zoho_only:   'bg-purple-100 text-purple-800',
    wc_unlinked: 'bg-amber-100 text-amber-800',
    wc_promo:    'bg-blue-100 text-blue-800',
    other:       'bg-gray-100 text-gray-600',
  }[segment] || 'bg-gray-100 text-gray-600'
  const label = SEGMENTS[segment]?.label || segment
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
}

function tableHeaders(tab) {
  if (tab === 'zoho_only') {
    return ['Coupon', 'Zoho orders', 'Revenue', 'Subtotal', 'Last used', '']
  }
  if (tab === 'wc_unlinked') {
    return ['Coupon', 'WC %', 'Zoho orders', 'Revenue', 'Issue', '']
  }
  if (tab === 'wc_promo') {
    return ['Coupon', 'WC %', 'Zoho orders', 'Revenue', 'Last used', '']
  }
  if (tab === 'wc_linked') {
    return ['Coupon', 'WC %', 'Affiliate', 'AWP ID', 'Zoho orders', 'Revenue', 'Est. commission', 'Last used', '']
  }
  return ['Coupon', 'Source', 'WC %', 'Affiliate', 'Zoho orders', 'Revenue', 'Est. commission', 'Last used', '']
}

function CouponRow({ c, tab, onEdit }) {
  const commission = c.est_commission != null
    ? <span className="font-semibold text-brand-orange">{fmt(c.est_commission)}</span>
    : <span className="text-gray-300">—</span>

  if (tab === 'zoho_only') {
    return (
      <tr className="tr-hover">
        <td className="td font-mono font-semibold">{c.coupon_code}</td>
        <td className="td text-right text-sm">{c.orders}</td>
        <td className="td text-right text-sm font-medium">{fmt(c.revenue)}</td>
        <td className="td text-right text-sm">{fmt(c.subtotal)}</td>
        <td className="td text-xs text-gray-500">{fmtDate(c.last_order)}</td>
        <td className="td text-right">
          <button onClick={() => onEdit(c)} className="btn-ghost px-2 py-1" title="Classify"><Pencil size={14} /></button>
        </td>
      </tr>
    )
  }

  if (tab === 'wc_unlinked') {
    return (
      <tr className="tr-hover">
        <td className="td font-mono font-semibold">{c.coupon_code}</td>
        <td className="td text-sm text-gray-600">{formatDiscount(c) || '—'}</td>
        <td className="td text-right text-sm">{c.orders}</td>
        <td className="td text-right text-sm font-medium">{fmt(c.revenue)}</td>
        <td className="td text-xs text-amber-700">No AffiliateWP link in WC</td>
        <td className="td text-right">
          <button onClick={() => onEdit(c)} className="btn-ghost px-2 py-1" title="Classify"><Pencil size={14} /></button>
        </td>
      </tr>
    )
  }

  if (tab === 'wc_promo') {
    return (
      <tr className="tr-hover">
        <td className="td font-mono font-semibold">{c.coupon_code}</td>
        <td className="td text-sm text-gray-600">{formatDiscount(c) || '—'}</td>
        <td className="td text-right text-sm">{c.orders}</td>
        <td className="td text-right text-sm font-medium">{fmt(c.revenue)}</td>
        <td className="td text-xs text-gray-500">{fmtDate(c.last_order)}</td>
        <td className="td" />
      </tr>
    )
  }

  if (tab === 'wc_linked') {
    return (
      <tr className="tr-hover">
        <td className="td font-mono font-semibold">{c.coupon_code}</td>
        <td className="td text-sm text-gray-600">{formatDiscount(c) || '—'}</td>
        <td className="td text-sm">{c.affiliate_name || '—'}</td>
        <td className="td text-sm text-gray-500 font-mono">{c.affiliate_id ?? '—'}</td>
        <td className="td text-right text-sm">{c.orders}</td>
        <td className="td text-right text-sm font-medium">{fmt(c.revenue)}</td>
        <td className="td text-right text-sm">{commission}</td>
        <td className="td text-xs text-gray-500">{fmtDate(c.last_order)}</td>
        <td className="td text-right">
          <button onClick={() => onEdit(c)} className="btn-ghost px-2 py-1" title="Edit"><Pencil size={14} /></button>
        </td>
      </tr>
    )
  }

  // all
  return (
    <tr className="tr-hover">
      <td className="td font-mono font-semibold">{c.coupon_code}</td>
      <td className="td"><SegmentBadge segment={c.segment} /></td>
      <td className="td text-sm text-gray-600">{formatDiscount(c) || '—'}</td>
      <td className="td text-sm">{c.affiliate_name || '—'}</td>
      <td className="td text-right text-sm">{c.orders}</td>
      <td className="td text-right text-sm font-medium">{fmt(c.revenue)}</td>
      <td className="td text-right text-sm">{commission}</td>
      <td className="td text-xs text-gray-500">{fmtDate(c.last_order)}</td>
      <td className="td text-right">
        <button onClick={() => onEdit(c)} className="btn-ghost px-2 py-1" title="Edit"><Pencil size={14} /></button>
      </td>
    </tr>
  )
}

export default function Coupons() {
  const [data, setData]       = useState({ items: [], summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [tab, setTab]         = useState('wc_linked')
  const [search, setSearch]   = useState('')
  const [editing, setEditing] = useState(null)

  const load = () => {
    setLoading(true)
    api.coupons()
      .then(d => setData({ items: d.items || [], summary: d.summary || null }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const s = data.summary
  const filtered = useMemo(() => {
    let rows = data.items
    if (tab !== 'all') rows = rows.filter(r => r.segment === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.coupon_code?.toLowerCase().includes(q) ||
        r.affiliate_name?.toLowerCase().includes(q) ||
        String(r.affiliate_id || '').includes(q))
    }
    return rows
  }, [data.items, tab, search])

  const tabs = [
    { key: 'wc_linked',   n: s?.wc_linked },
    { key: 'zoho_only',   n: s?.zoho_only },
    { key: 'wc_unlinked', n: s?.wc_unlinked },
    { key: 'wc_promo',    n: s?.wc_promo },
    { key: 'all',         n: s?.total_codes },
  ]

  const headers = tableHeaders(tab)
  const colSpan = headers.length

  return (
    <div>
      <PageHeader
        title="Coupons"
        subtitle="Split by source: WooCommerce + AffiliateWP vs Zoho order usage"
        actions={
          <ExportButtons baseName={`coupons-${tab}`} sheetName="Coupons" columns={EXPORT_COLUMNS} rows={filtered} />
        }
      />

      {error && <ErrorMsg error={error} />}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 mb-4">
          <StatCard label="WC + AffiliateWP" value={s.wc_linked}
            sub={`${s.unused_in_zoho ?? 0} linked codes with no Zoho orders yet`} color="text-green-600" />
          <StatCard label="Zoho only" value={s.zoho_only}
            sub={fmt(s.zoho_only_revenue) + ' revenue'} color="text-purple-600" />
          <StatCard label="WC unlinked" value={s.wc_unlinked}
            sub="affiliate coupon, no owner" color="text-amber-600" />
          <StatCard label="Est. commission" value={fmt(s.est_commission)}
            sub="linked affiliates only" color="text-brand-orange" />
        </div>
      )}

      <div className="mx-6 mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
        <span>
          <strong>WC + AffiliateWP</strong> — coupon exists in WooCommerce and has an owner via{' '}
          <code>affwp_discount_affiliate</code>. Commission = Net Sales (excl. shipping) × WC discount %.
          <strong> Zoho only</strong> — code appeared on orders (<code>cf_coupon_s</code>) but is not in WooCommerce;
          no commission until classified and linked.
          <strong> WC unlinked</strong> — marked affiliate in WooCommerce but no AffiliateWP ID; revenue shows, commission does not.
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 mb-1">
        <div className="flex flex-wrap gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-navy-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {SEGMENTS[t.key].label}
              {t.n != null && <span className="ml-1.5 opacity-60">{t.n}</span>}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input className="input pl-8 w-60" placeholder="Search coupon or affiliate…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <p className="px-6 mb-3 text-xs text-gray-500">{SEGMENTS[tab].short}</p>

      <div className="px-6 pb-8">
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {headers.map((h, i) => (
                  <th key={i} className={`th ${
                    ['Zoho orders', 'Revenue', 'Subtotal', 'Est. commission'].includes(h) ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={colSpan}><Spinner /></td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={colSpan}><Empty label="No coupons in this group" /></td></tr>
                  : filtered.map(c => (
                    <CouponRow key={c.coupon_code} c={c} tab={tab} onEdit={setEditing} />
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditCouponModal coupon={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

function EditCouponModal({ coupon, onClose, onSaved }) {
  const [form, setForm] = useState({
    kind:            coupon.kind || 'unclassified',
    affiliate_name:  coupon.affiliate_name || '',
    affiliate_email: coupon.affiliate_email || '',
    rate:            coupon.rate ?? '',
    confirmed:       !!coupon.confirmed,
    notes:           coupon.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await api.updateCoupon(coupon.coupon_code, {
        ...form,
        rate: form.rate === '' ? null : Number(form.rate),
      })
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <Modal title={`Coupon: ${coupon.coupon_code}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500 bg-gray-50 rounded-md px-3 py-2">
          {coupon.segment && <div>Segment: <strong>{SEGMENTS[coupon.segment]?.label || coupon.segment}</strong></div>}
          {coupon.orders} Zoho orders · {fmt(coupon.revenue)} revenue · subtotal {fmt(coupon.subtotal)}
          {coupon.affiliate_id && <div>AffiliateWP ID: {coupon.affiliate_id}</div>}
        </div>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Type</span>
          <select className="select mt-1" value={form.kind} onChange={e => set('kind', e.target.value)}>
            <option value="affiliate">Affiliate (earns commission)</option>
            <option value="promo">Promo (marketing, no commission)</option>
            <option value="unclassified">Unclassified</option>
          </select>
        </label>

        {form.kind === 'affiliate' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Affiliate</span>
                <input className="input mt-1" value={form.affiliate_name}
                  onChange={e => set('affiliate_name', e.target.value)} placeholder="Name" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Commission rate %</span>
                <input className="input mt-1" type="number" step="0.5" value={form.rate}
                  onChange={e => set('rate', e.target.value)} placeholder="e.g. 5" />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Email</span>
              <input className="input mt-1" value={form.affiliate_email}
                onChange={e => set('affiliate_email', e.target.value)} placeholder="email@example.com" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.confirmed} onChange={e => set('confirmed', e.target.checked)} />
              <span className="text-sm text-gray-700">Owner confirmed by Accounting</span>
            </label>
          </>
        )}

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Notes</span>
          <textarea className="input mt-1" rows={2} value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </label>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
