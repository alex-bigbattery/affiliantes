import { useState, useEffect, useCallback } from 'react'
import { Calculator, Info, Search, RefreshCw } from 'lucide-react'
import { api, fmt } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatCard } from '../components/Layout'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

function toIsoDate(s) {
  if (!s) return ''
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return t
}

export default function SalesTax() {
  const [tab, setTab] = useState('orders')

  // Manual calculator
  const [form, setForm] = useState({
    line1: '', city: '', state: 'CA', zip: '', county: '',
    subtotal: '', shipping: '', customer_type: 'retail',
  })
  const [calcResult, setCalcResult] = useState(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [calcError, setCalcError] = useState(null)
  const setFormField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Orders list
  const [filters, setFilters] = useState({
    search: '', ship_state: '', date_from: '', date_to: '', has_state: '',
  })
  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState(null)

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    setOrdersError(null)
    try {
      const data = await api.taxOrders({
        number: 'all',
        search: filters.search || undefined,
        ship_state: filters.ship_state || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        has_state: filters.has_state || undefined,
      })
      setOrders(data.items || [])
      setTotal(data.total || 0)
      setSummary(data.summary || null)
    } catch (e) {
      setOrdersError(e.message)
    } finally {
      setOrdersLoading(false)
    }
  }, [filters])

  useEffect(() => {
    if (tab === 'orders') loadOrders()
  }, [tab, loadOrders])

  const calculate = async () => {
    setCalcLoading(true); setCalcError(null); setCalcResult(null)
    try {
      const r = await api.taxEstimate({
        shipping_address: {
          line1: form.line1.trim(), city: form.city.trim(),
          state: form.state.trim().toUpperCase(), postal_code: form.zip.trim(),
          county: form.county.trim(), country: 'US',
        },
        subtotal: Number(form.subtotal),
        shipping_amount: Number(form.shipping || 0),
        customer_type: form.customer_type,
      })
      setCalcResult(r)
    } catch (e) { setCalcError(e.message) }
    finally { setCalcLoading(false) }
  }

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  return (
    <div>
      <PageHeader
        title="Sales Tax"
        subtitle="Estimated US sales tax by shipping address — any payment method"
      />

      <div className="mx-4 sm:mx-6 mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
        <span>
          <strong>Estimate only.</strong> Uses each state’s average combined rate (free, no paid API).
          Orders use the shipping state from Zoho/WooCommerce. For compliant tax use Avalara, TaxJar, or Stripe Tax.
        </span>
      </div>

      <div className="px-4 sm:px-6 mb-4 flex gap-2">
        <button
          type="button"
          className={tab === 'orders' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('orders')}
        >
          Orders with tax
        </button>
        <button
          type="button"
          className={tab === 'calculator' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('calculator')}
        >
          <Calculator size={15} className="inline mr-1" /> Manual calculator
        </button>
      </div>

      {tab === 'orders' && (
        <div className="px-4 sm:px-6 pb-8 space-y-4">
          {/* Filters */}
          <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="block lg:col-span-2">
              <span className="text-xs text-gray-500">Search order / customer</span>
              <div className="relative mt-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-8"
                  value={filters.search}
                  onChange={e => setFilter('search', e.target.value)}
                  placeholder="BB-12345 or customer name"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Ship state</span>
              <select className="select mt-1" value={filters.ship_state} onChange={e => setFilter('ship_state', e.target.value)}>
                <option value="">All states</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">From date</span>
              <input type="date" className="input mt-1" value={filters.date_from}
                onChange={e => setFilter('date_from', toIsoDate(e.target.value))} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">To date</span>
              <input type="date" className="input mt-1" value={filters.date_to}
                onChange={e => setFilter('date_to', toIsoDate(e.target.value))} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Address state</span>
              <select className="select mt-1" value={filters.has_state} onChange={e => setFilter('has_state', e.target.value)}>
                <option value="">Any</option>
                <option value="true">Has state</option>
                <option value="false">Missing state</option>
              </select>
            </label>
            <div className="flex items-end">
              <button type="button" className="btn-secondary w-full" onClick={loadOrders} disabled={ordersLoading}>
                <RefreshCw size={14} className={ordersLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Orders" value={summary.orders_count ?? orders.length} />
              <StatCard label="Subtotal" value={fmt(summary.total_subtotal)} />
              <StatCard label="Est. tax" value={fmt(summary.total_estimated_tax)} color="text-brand-orange" />
              <StatCard label="Total w/ tax" value={fmt(summary.total_with_tax)} color="text-green-700" />
            </div>
          )}

          {ordersError && <ErrorMsg error={ordersError} />}

          <div className="card overflow-hidden">
            {ordersLoading ? (
              <div className="p-8"><Spinner /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Ship to</th>
                      <th className="text-right">Subtotal</th>
                      <th className="text-right">Shipping</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Est. tax</th>
                      <th className="text-right">Total w/ tax</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 ? (
                      <tr><td colSpan={10} className="text-center text-gray-400 py-8">No orders match filters</td></tr>
                    ) : orders.map(o => (
                      <tr key={o.salesorder_id || o.salesorder_number}>
                        <td className="font-medium whitespace-nowrap">{o.salesorder_number}</td>
                        <td className="whitespace-nowrap">{o.order_date || '—'}</td>
                        <td className="max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
                        <td className="whitespace-nowrap">
                          {o.tax_error === 'missing_state' ? (
                            <span className="text-amber-600 text-xs">No state</span>
                          ) : (
                            <span>
                              {o.shipping_address?.state || '—'}
                              {o.shipping_address?.city ? ` · ${o.shipping_address.city}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="text-right">{fmt(o.sub_total)}</td>
                        <td className="text-right">{fmt(o.shipping_charge)}</td>
                        <td className="text-right">
                          {o.tax ? `${o.tax.rate_pct}%` : '—'}
                        </td>
                        <td className="text-right font-medium text-brand-orange">
                          {o.tax ? fmt(o.tax.tax) : '—'}
                        </td>
                        <td className="text-right font-medium">
                          {o.tax ? fmt(o.tax.total_with_tax) : fmt(o.sub_total + o.shipping_charge)}
                        </td>
                        <td className="text-xs text-gray-500">{o.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="text-sm text-gray-500">
            Showing {orders.length.toLocaleString()} of {total.toLocaleString()} orders
          </div>
        </div>
      )}

      {tab === 'calculator' && (
        <div className="px-4 sm:px-6 pb-8 grid gap-6 lg:grid-cols-2">
          <form onSubmit={e => { e.preventDefault(); calculate() }} className="card p-5 space-y-4">
            <div className="text-sm font-semibold text-gray-700">Shipping address & order</div>
            <label className="block">
              <span className="text-sm text-gray-600">Street (line 1)</span>
              <input className="input mt-1" value={form.line1} onChange={e => setFormField('line1', e.target.value)} placeholder="123 Main St" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm text-gray-600">City</span>
                <input className="input mt-1" value={form.city} onChange={e => setFormField('city', e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">County</span>
                <input className="input mt-1" value={form.county} onChange={e => setFormField('county', e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm text-gray-600">State *</span>
                <select className="select mt-1" value={form.state} onChange={e => setFormField('state', e.target.value)}>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">ZIP</span>
                <input className="input mt-1" value={form.zip} onChange={e => setFormField('zip', e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm text-gray-600">Subtotal ($) *</span>
                <input className="input mt-1" type="number" step="0.01" min="0" value={form.subtotal}
                  onChange={e => setFormField('subtotal', e.target.value)} required />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">Shipping ($)</span>
                <input className="input mt-1" type="number" step="0.01" min="0" value={form.shipping}
                  onChange={e => setFormField('shipping', e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="text-sm text-gray-600">Customer type</span>
              <select className="select mt-1" value={form.customer_type} onChange={e => setFormField('customer_type', e.target.value)}>
                <option value="retail">Retail (taxable)</option>
                <option value="exempt">Tax-exempt</option>
              </select>
            </label>
            <button type="submit" className="btn-primary w-full" disabled={calcLoading || !form.subtotal}>
              <Calculator size={15} /> {calcLoading ? 'Calculating…' : 'Estimate tax'}
            </button>
          </form>

          <div className="space-y-4">
            {calcError && <ErrorMsg error={calcError} />}
            {calcLoading && <div className="card"><Spinner /></div>}
            {calcResult && !calcLoading && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Subtotal" value={fmt(calcResult.subtotal)} />
                  <StatCard label="Shipping" value={fmt(calcResult.shipping)} />
                  <StatCard label={`Tax (${calcResult.rate_pct}%)`} value={fmt(calcResult.tax)} color="text-brand-orange" sub={calcResult.state} />
                  <StatCard label="Total" value={fmt(calcResult.total)} color="text-green-700" />
                </div>
                <div className="card p-4 text-sm text-gray-600">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 mb-2">Estimated</span>
                  <div>{calcResult.note}</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
