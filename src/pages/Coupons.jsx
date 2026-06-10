import { useState, useEffect, useMemo } from 'react'
import { Info, Pencil, Search, Tag } from 'lucide-react'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty, Modal, StatCard } from '../components/Layout'
import ExportButtons from '../components/ExportButtons'

const EXPORT_COLUMNS = [
  { header: 'Coupon',         value: c => c.coupon_code },
  { header: 'Type',           value: c => c.kind },
  { header: 'Affiliate',      value: c => c.affiliate_name || '' },
  { header: 'Rate %',         value: c => c.rate ?? '' },
  { header: 'Orders',         value: c => Number(c.orders || 0) },
  { header: 'Revenue',        value: c => Number(c.revenue || 0) },
  { header: 'Subtotal',       value: c => Number(c.subtotal || 0) },
  { header: 'Est. commission', value: c => c.est_commission != null ? Number(c.est_commission) : '' },
  { header: 'Confirmed',      value: c => c.confirmed ? 'yes' : 'no' },
  { header: 'First order',    value: c => c.first_order ? String(c.first_order).slice(0, 10) : '' },
  { header: 'Last order',     value: c => c.last_order ? String(c.last_order).slice(0, 10) : '' },
]

const KIND_META = {
  affiliate:    { label: 'Affiliate',    cls: 'bg-green-100 text-green-700' },
  promo:        { label: 'Promo',        cls: 'bg-blue-100 text-blue-700' },
  unclassified: { label: 'Unclassified', cls: 'bg-amber-100 text-amber-700' },
}

function KindBadge({ kind }) {
  const m = KIND_META[kind] || KIND_META.unclassified
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${m.cls}`}>{m.label}</span>
}

export default function Coupons() {
  const [data, setData]       = useState({ items: [], summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [tab, setTab]         = useState('all')
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
    if (tab !== 'all') rows = rows.filter(r => r.kind === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.coupon_code?.toLowerCase().includes(q) ||
        r.affiliate_name?.toLowerCase().includes(q))
    }
    return rows
  }, [data.items, tab, search])

  const tabs = [
    { key: 'all',          label: 'All',          n: data.items.length },
    { key: 'affiliate',    label: 'Affiliates',   n: s?.affiliate_codes },
    { key: 'promo',        label: 'Promos',       n: s?.promo_codes },
    { key: 'unclassified', label: 'Unclassified', n: s?.unclassified },
  ]

  return (
    <div>
      <PageHeader
        title="Coupons"
        subtitle="Real coupon usage from Zoho orders (cf_coupon_s field)"
        actions={
          <ExportButtons baseName="coupons" sheetName="Coupons" columns={EXPORT_COLUMNS} rows={filtered} />
        }
      />

      {error && <ErrorMsg error={error} />}

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 mb-4">
          <StatCard label="Codes used" value={s.total_codes}
            sub={`${s.total_orders} orders`} />
          <StatCard label="Affiliate coupons" value={s.affiliate_codes}
            sub={`${s.unclassified} unclassified`} color="text-green-600" />
          <StatCard label="Affiliate revenue" value={fmt(s.affiliate_revenue)}
            sub={`of ${fmt(s.total_revenue)} total`} color="text-navy-700" />
          <StatCard label="Estimated commission" value={fmt(s.est_commission)}
            sub="affiliates with defined rate" color="text-brand-orange" />
        </div>
      )}

      {/* Info note */}
      <div className="mx-6 mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
        <span>
          AffiliateWP doesn't expose coupons via API, so this data comes straight from your Zoho orders.
          Estimated commission = subtotal × affiliate rate. Edit the classification with the pencil to
          assign an owner and rate to <strong>unclassified</strong> coupons.
        </span>
      </div>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 mb-3">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-navy-700 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {t.label}{t.n != null && <span className="ml-1.5 opacity-60">{t.n}</span>}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input className="input pl-8 w-60" placeholder="Search coupon or affiliate…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="px-6 pb-8">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {['Coupon','Type','Affiliate','Rate','Orders','Revenue','Est. commission','Last used',''].map((h,i) =>
                  <th key={i} className={`th ${['Orders','Revenue','Est. commission'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={9}><Spinner /></td></tr>
                : filtered.length === 0
                  ? <tr><td colSpan={9}><Empty label="No coupons" /></td></tr>
                  : filtered.map(c => (
                    <tr key={c.coupon_code} className="tr-hover">
                      <td className="td font-mono font-semibold flex items-center gap-1.5">
                        <Tag size={13} className="text-gray-400" />{c.coupon_code}
                      </td>
                      <td className="td"><KindBadge kind={c.kind} /></td>
                      <td className="td text-sm">
                        {c.affiliate_name || <span className="text-gray-400">—</span>}
                        {c.kind === 'affiliate' && !c.confirmed &&
                          <span className="ml-1.5 text-xs text-amber-600" title="Owner unconfirmed">⚠</span>}
                      </td>
                      <td className="td text-sm">{c.rate != null ? `${c.rate}%` : <span className="text-gray-300">—</span>}</td>
                      <td className="td text-right text-sm">{c.orders}</td>
                      <td className="td text-right text-sm font-medium">{fmt(c.revenue)}</td>
                      <td className="td text-right text-sm">
                        {c.est_commission != null
                          ? <span className="font-semibold text-brand-orange">{fmt(c.est_commission)}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="td text-xs text-gray-500">{fmtDate(c.last_order)}</td>
                      <td className="td text-right">
                        <button onClick={() => setEditing(c)} className="btn-ghost px-2 py-1" title="Edit classification">
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
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
          {coupon.orders} orders · {fmt(coupon.revenue)} in revenue · subtotal {fmt(coupon.subtotal)}
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
