import { useState, useEffect, useCallback } from 'react'
import { Calculator, Info, Search, RefreshCw, Save, RotateCcw } from 'lucide-react'
import { api, fmt } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatCard } from '../components/Layout'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

const PROVIDERS = [
  { id: 'state_avg', label: 'State average', hint: 'Free · editable · saved in Supabase' },
  { id: 'ziptax', label: 'Ziptax', hint: 'Address-level · API key on server' },
  { id: 'taxlocus', label: 'TaxLocus', hint: 'Address + breakdown · API key' },
  { id: 'salestaxzip', label: 'SalesTaxZip', hint: 'Free · no API key · shipping ZIP only (not full address)' },
]

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

function RateEditor({ order, onSave, onClear, saving }) {
  const [pct, setPct] = useState(order.tax?.rate_pct ?? '')
  useEffect(() => { setPct(order.tax?.rate_pct ?? '') }, [order.tax?.rate_pct, order.salesorder_number])

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        step="0.001"
        min="0"
        max="100"
        className="input w-20 text-right text-xs py-1 px-1.5"
        value={pct}
        onChange={e => setPct(e.target.value)}
        title="Rate % — saved to Supabase"
      />
      <span className="text-xs text-gray-400">%</span>
      <button
        type="button"
        className="p-1 text-navy-700 hover:bg-gray-100 rounded"
        title="Save rate"
        disabled={saving || pct === ''}
        onClick={() => onSave(order, Number(pct))}
      >
        <Save size={13} />
      </button>
      {order.has_override && (
        <button
          type="button"
          className="p-1 text-gray-400 hover:text-red-600 rounded"
          title="Clear saved rate"
          disabled={saving}
          onClick={() => onClear(order)}
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  )
}

export default function SalesTax() {
  const [tab, setTab] = useState('orders')
  const [provider, setProvider] = useState('state_avg')
  const [providerMeta, setProviderMeta] = useState([])

  const [form, setForm] = useState({
    line1: '', city: '', state: 'CA', zip: '', county: '',
    subtotal: '', shipping: '', customer_type: 'retail',
  })
  const [calcResult, setCalcResult] = useState(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [calcError, setCalcError] = useState(null)
  const setFormField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const [filters, setFilters] = useState({
    search: '', ship_state: '', date_from: '', date_to: '', has_state: '',
  })
  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState(null)
  const [savingOrder, setSavingOrder] = useState(null)

  useEffect(() => {
    api.taxProviders().then(d => setProviderMeta(d.providers || [])).catch(() => {})
  }, [])

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    setOrdersError(null)
    try {
      const data = await api.taxOrders({
        number: 'all',
        provider,
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
  }, [filters, provider])

  useEffect(() => {
    if (tab === 'orders') loadOrders()
  }, [tab, loadOrders])

  const saveOverride = async (order, ratePct) => {
    if (!Number.isFinite(ratePct) || ratePct < 0) return
    setSavingOrder(order.salesorder_number)
    try {
      const tax_amount = roundMoney(order.sub_total * (ratePct / 100))
      await api.taxSaveOverride(order.salesorder_number, {
        rate_pct: ratePct,
        tax_amount,
        provider: 'state_avg',
      })
      await loadOrders()
    } catch (e) {
      setOrdersError(e.message)
    } finally {
      setSavingOrder(null)
    }
  }

  const clearOverride = async (order) => {
    setSavingOrder(order.salesorder_number)
    try {
      await api.taxClearOverride(order.salesorder_number)
      await loadOrders()
    } catch (e) {
      setOrdersError(e.message)
    } finally {
      setSavingOrder(null)
    }
  }

  const calculate = async () => {
    setCalcLoading(true); setCalcError(null); setCalcResult(null)
    try {
      const r = await api.taxEstimate({
        provider,
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
  const providerInfo = PROVIDERS.find(p => p.id === provider)
  const isConfigured = (id) => providerMeta.find(p => p.id === id)?.configured !== false

  return (
    <div>
      <PageHeader
        title="Sales Tax"
        subtitle="BB web orders only · excludes void, cancelled, and refunded"
      />

      <div className="px-4 sm:px-6 mb-4">
        <div className="text-xs font-medium text-gray-500 mb-2">Rate source</div>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map(p => {
            const configured = isConfigured(p.id)
            return (
              <button
                key={p.id}
                type="button"
                title={p.hint + (configured ? '' : ' — not configured on server')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  provider === p.id
                    ? 'bg-navy-700 text-white border-navy-700'
                    : configured
                      ? 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                      : 'bg-gray-50 text-gray-400 border-gray-100'
                }`}
                onClick={() => setProvider(p.id)}
              >
                {p.label}
                {!configured && p.id !== 'state_avg' && p.id !== 'salestaxzip' && (
                  <span className="ml-1 text-[10px] opacity-70">(no key)</span>
                )}
              </button>
            )
          })}
        </div>
        {providerInfo && (
          <p className="mt-2 text-xs text-gray-500">{providerInfo.hint}</p>
        )}
      </div>

      <div className="mx-4 sm:mx-6 mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-500" />
        <span>
          <strong>Estimate only</strong> — not for tax filing or compliance.{' '}
          Includes paid/processing BB orders from WooCommerce/Zoho; SO bulk invoices and void/refunded orders are excluded.{' '}
          {provider === 'state_avg'
            ? 'State average table — edit a row’s rate % and Save to store a custom value in Supabase.'
            : provider === 'salestaxzip'
              ? 'SalesTaxZip is free and needs no API key. It looks up the combined rate for the order’s shipping ZIP (5 digits). It does not use street address, so it is less precise than Ziptax or TaxLocus but usually better than the state-average tab.'
            : provider === 'ziptax'
              ? 'Ziptax uses the full shipping address (requires ZIPTAX_API_KEY on Render).'
              : 'TaxLocus uses the full shipping address and returns a jurisdiction breakdown (requires TAXLOCUS_API_KEY on Render).'}
        </span>
      </div>

      <div className="px-4 sm:px-6 mb-4 flex gap-2">
        <button type="button" className={tab === 'orders' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('orders')}>
          Orders with tax
        </button>
        <button type="button" className={tab === 'calculator' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('calculator')}>
          <Calculator size={15} className="inline mr-1" /> Manual calculator
        </button>
      </div>

      {tab === 'orders' && (
        <div className="px-4 sm:px-6 pb-8 space-y-4">
          <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="block lg:col-span-2">
              <span className="text-xs text-gray-500">Search order / customer</span>
              <div className="relative mt-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-8" value={filters.search} onChange={e => setFilter('search', e.target.value)} placeholder="BB-12345 or customer name" />
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
              <input type="date" className="input mt-1" value={filters.date_from} onChange={e => setFilter('date_from', toIsoDate(e.target.value))} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">To date</span>
              <input type="date" className="input mt-1" value={filters.date_to} onChange={e => setFilter('date_to', toIsoDate(e.target.value))} />
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
                      <tr key={o.salesorder_id || o.salesorder_number} className={o.has_override ? 'bg-amber-50/40' : ''}>
                        <td className="font-medium whitespace-nowrap">{o.salesorder_number}</td>
                        <td className="whitespace-nowrap">{o.order_date || '—'}</td>
                        <td className="max-w-[160px] truncate" title={o.customer_name}>{o.customer_name || '—'}</td>
                        <td className="whitespace-nowrap text-xs">
                          {o.tax_error === 'missing_state' ? (
                            <span className="text-amber-600">No state</span>
                          ) : (
                            <span>
                              {o.shipping_address?.state || '—'}
                              {o.shipping_address?.postal_code ? ` ${o.shipping_address.postal_code}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="text-right">{fmt(o.sub_total)}</td>
                        <td className="text-right">{fmt(o.shipping_charge)}</td>
                        <td className="text-right">
                          {provider === 'state_avg' && o.tax ? (
                            <RateEditor
                              order={o}
                              saving={savingOrder === o.salesorder_number}
                              onSave={saveOverride}
                              onClear={clearOverride}
                            />
                          ) : o.tax ? (
                            <span>{o.tax.rate_pct}%</span>
                          ) : (
                            <span className="text-xs text-red-500" title={o.tax_error}>{o.tax_error || '—'}</span>
                          )}
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
            {summary?.unique_rate_lookups != null && provider !== 'state_avg' && (
              <span> · {summary.unique_rate_lookups} unique rate lookups</span>
            )}
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
              <Calculator size={15} /> {calcLoading ? 'Calculating…' : `Estimate tax (${providerInfo?.label})`}
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
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 mb-2">Estimated · {calcResult.source}</span>
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

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
