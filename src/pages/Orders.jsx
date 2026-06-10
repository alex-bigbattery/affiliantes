import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty, StatCard } from '../components/Layout'
import ExportButtons from '../components/ExportButtons'

const PAGE_SIZE = 50

const EXPORT_COLUMNS = [
  { header: 'Order #',      value: o => o.salesorder_number || o.salesorder_id },
  { header: 'Date',         value: o => o.order_date ? String(o.order_date).slice(0, 10) : '' },
  { header: 'Customer',     value: o => o.customer_name || '' },
  { header: 'Coupon',       value: o => o.coupon_code || '' },
  { header: 'Affiliate',    value: o => o.affiliate_name || '' },
  { header: 'Subtotal',     value: o => Number(o.sub_total || 0) },
  { header: 'Total',        value: o => Number(o.total || 0) },
  { header: 'Status',       value: o => o.status || '' },
  { header: 'Salesperson',  value: o => o.salesperson_name || '' },
  { header: 'Reference',    value: o => o.reference_number || '' },
]

export default function Orders() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData]       = useState({ items: [], total: 0, summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [offset, setOffset]   = useState(0)

  const search    = searchParams.get('q') || ''
  const status    = searchParams.get('status') || ''
  const hasCoupon = searchParams.get('coupon') || 'all'
  const dateFrom  = searchParams.get('from') || ''
  const dateTo    = searchParams.get('to') || ''

  const setParam = (k, v) => {
    const p = new URLSearchParams(searchParams)
    v ? p.set(k, v) : p.delete(k)
    setSearchParams(p)
    setOffset(0)
  }

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = { number: PAGE_SIZE, offset, order: 'DESC' }
    if (search)    params.search = search
    if (status)    params.status = status
    if (dateFrom)  params.date_from = dateFrom
    if (dateTo)    params.date_to = dateTo
    if (hasCoupon === 'yes') params.has_coupon = 'true'
    if (hasCoupon === 'no')  params.has_coupon = 'false'

    api.orders(params)
      .then(d => setData({ items: d.items || [], total: d.total || 0, summary: d.summary }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [search, status, hasCoupon, dateFrom, dateTo, offset])

  useEffect(() => { load() }, [load])

  const s = data.summary
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Zoho sales orders from Supabase (cf_coupon_s coupon field)"
        actions={
          <ExportButtons baseName="orders" sheetName="Orders" columns={EXPORT_COLUMNS} rows={data.items} />
        }
      />

      {error && <ErrorMsg error={error} />}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 mb-4">
          <StatCard label="Orders (filtered)" value={s.filtered_orders?.toLocaleString()}
            sub={`${data.total.toLocaleString()} matching filters`} />
          <StatCard label="With coupon" value={s.with_coupon?.toLocaleString()}
            sub="cf_coupon_s on order" color="text-green-600" />
          <StatCard label="Subtotal" value={fmt(s.total_subtotal)} color="text-navy-700" />
          <StatCard label="Total revenue" value={fmt(s.total_revenue)} color="text-brand-orange" />
        </div>
      )}

      <div className="px-6 mb-4 flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input className="input pl-8 w-full" placeholder="Order #, customer, coupon…"
            defaultValue={search}
            onKeyDown={e => e.key === 'Enter' && setParam('q', e.target.value.trim())}
            onBlur={e => { if (e.target.value.trim() !== search) setParam('q', e.target.value.trim()) }} />
        </div>
        <label className="block">
          <span className="text-xs text-gray-500 flex items-center gap-1 mb-1"><Filter size={12} /> Coupon</span>
          <select className="select" value={hasCoupon} onChange={e => setParam('coupon', e.target.value === 'all' ? '' : e.target.value)}>
            <option value="all">All orders</option>
            <option value="yes">With coupon</option>
            <option value="no">No coupon</option>
          </select>
        </label>
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
                {['Order #', 'Date', 'Customer', 'Coupon', 'Affiliate', 'Subtotal', 'Total', 'Status'].map((h, i) => (
                  <th key={i} className={`th ${['Subtotal', 'Total'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={8}><Spinner /></td></tr>
                : data.items.length === 0
                  ? <tr><td colSpan={8}><Empty label="No orders" /></td></tr>
                  : data.items.map(o => (
                    <tr key={o.salesorder_id} className="tr-hover">
                      <td className="td font-mono text-sm font-medium">{o.salesorder_number || o.salesorder_id}</td>
                      <td className="td text-sm text-gray-600">{fmtDate(o.order_date)}</td>
                      <td className="td text-sm max-w-[180px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
                      <td className="td font-mono text-sm">
                        {o.coupon_code
                          ? <span className="text-navy-700">{o.coupon_code}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="td text-sm max-w-[140px] truncate" title={o.affiliate_name}>
                        {o.affiliate_name || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="td text-right text-sm">{fmt(o.sub_total)}</td>
                      <td className="td text-right text-sm font-medium">{fmt(o.total)}</td>
                      <td className="td text-sm capitalize text-gray-600">{o.status || '—'}</td>
                    </tr>
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
