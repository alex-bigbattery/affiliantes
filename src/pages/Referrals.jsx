import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatusBadge, Empty } from '../components/Layout'
import { CheckSquare, Square, ChevronLeft, ChevronRight } from 'lucide-react'
import ExportButtons from '../components/ExportButtons'

const STATUSES = ['all', 'open', 'estimated', 'unpaid', 'paid', 'pending', 'rejected']
const PAGE_SIZE = 50

function rowKey(r) {
  return r.salesorder_number || String(r.referral_id)
}

export default function Referrals() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [referrals, setReferrals] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [affiliates, setAffiliates] = useState([])
  const [offset, setOffset] = useState(0)

  const status = searchParams.get('status') || 'all'
  const affId = searchParams.get('affiliate') || ''
  const dateFrom = searchParams.get('from') || ''
  const dateTo = searchParams.get('to') || ''

  const set = (k, v) => {
    const p = new URLSearchParams(searchParams)
    v ? p.set(k, v) : p.delete(k)
    setSearchParams(p)
    setOffset(0)
    setSelected(new Set())
  }

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = {
      number: PAGE_SIZE,
      offset,
      orderby: 'date',
      order: 'DESC',
    }
    if (status && status !== 'all') params.status = status
    if (affId) params.affiliate_id = affId
    if (dateFrom) params.date = dateFrom
    if (dateTo) params.end_date = dateTo

    api.referrals(params)
      .then(d => {
        const items = Array.isArray(d) ? d : (d?.items || [])
        setReferrals(items)
        setTotal(d?.total ?? items.length)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, affId, dateFrom, dateTo, offset])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.affiliates({ number: 500 }).then(d => setAffiliates(Array.isArray(d) ? d : []))
  }, [])

  const toggleSelect = id => setSelected(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })
  const toggleAll = () =>
    setSelected(selected.size === referrals.length ? new Set() : new Set(referrals.map(rowKey)))

  const bulkUpdate = async (newStatus) => {
    if (!selected.size) return
    if (!confirm(`Change ${selected.size} commission rows to "${newStatus}"?`)) return
    setBulkWorking(true)
    try {
      const res = await api.bulkReferrals([...selected], newStatus)
      if (res.failed > 0) {
        alert(`Updated ${res.updated}, failed ${res.failed}: ${res.errors?.[0]?.error || 'see console'}`)
        console.warn('Bulk errors', res.errors)
      }
      setSelected(new Set())
      load()
    } catch (e) { alert(e.message) }
    finally { setBulkWorking(false) }
  }

  const updateOne = async (r, newStatus) => {
    try {
      const id = rowKey(r)
      await api.updateReferral(id, { status: newStatus })
      setReferrals(prev => prev.map(x => rowKey(x) === id ? { ...x, status: newStatus } : x))
    } catch (e) { alert(e.message) }
  }

  const affLabel = (r) =>
    r.affiliate_name
    || affiliates.find(a => a.affiliate_id === r.affiliate_id)?.display_name
    || affiliates.find(a => a.affiliate_id === r.affiliate_id)?.payment_email
    || (r.affiliate_id ? `#${r.affiliate_id}` : '—')

  const exportColumns = [
    { header: 'Order', value: r => r.salesorder_number || r.referral_id },
    { header: 'Date', value: r => r.date },
    { header: 'Affiliate ID', value: r => r.affiliate_id },
    { header: 'Affiliate', value: affLabel },
    { header: 'Coupon', value: r => r.coupon_code },
    { header: 'WC Reference', value: r => r.reference },
    { header: 'Net sales', value: r => Number(r.net_sales || 0) },
    { header: 'Rate %', value: r => r.commission_rate },
    { header: 'Commission', value: r => Number(r.amount || 0) },
    { header: 'Status', value: r => r.status },
    { header: 'Source', value: r => r.source },
  ]

  const openTotal = referrals
    .filter(r => r.status !== 'paid')
    .reduce((s, r) => s + parseFloat(r.amount || 0), 0)

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <PageHeader
        title="Commissions"
        subtitle={`${total} orders with affiliate coupons · by order date (Supabase)`}
        actions={
          <ExportButtons baseName="commissions" sheetName="Commissions" columns={exportColumns} rows={referrals} />
        }
      />

      <p className="px-6 -mt-2 mb-4 text-xs text-gray-500">
        Complete ledger from Zoho/WC orders. Rows marked <strong>estimated</strong> have no AffiliateWP referral yet.
        Status changes save in Supabase; WP-linked rows also sync to AffiliateWP when possible.
      </p>

      <div className="flex flex-wrap gap-1 border-b mx-6 mb-4">
        {STATUSES.map(s => (
          <button key={s} onClick={() => set('status', s === 'all' ? '' : s)}
            className={`px-3 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              status === (s === 'all' ? '' : s) || (s === 'all' && !status)
                ? 'border-navy-700 text-navy-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-6 mb-4">
        <select className="select w-52" value={affId} onChange={e => set('affiliate', e.target.value)}>
          <option value="">All affiliates</option>
          {affiliates.map(a => (
            <option key={a.affiliate_id} value={a.affiliate_id}>
              #{a.affiliate_id} — {a.display_name || a.username || a.payment_email || `user ${a.user_id}`}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-40" value={dateFrom} onChange={e => set('from', e.target.value)} />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" className="input w-40" value={dateTo} onChange={e => set('to', e.target.value)} />
        </div>
        {(affId || dateFrom || dateTo) && (
          <button className="btn-ghost text-xs" onClick={() => {
            const p = new URLSearchParams(searchParams)
            p.delete('affiliate'); p.delete('from'); p.delete('to')
            setSearchParams(p)
          }}>
            Clear filters ×
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mx-6 mb-3 px-4 py-2.5 bg-navy-50 border border-navy-100 rounded-lg flex items-center gap-3 text-sm">
          <span className="font-medium text-navy-700">{selected.size} selected</span>
          <div className="flex gap-2">
            <button className="btn-primary text-xs py-1" onClick={() => bulkUpdate('paid')} disabled={bulkWorking}>
              Mark paid
            </button>
            <button className="btn-outline text-xs py-1" onClick={() => bulkUpdate('unpaid')} disabled={bulkWorking}>
              Mark unpaid
            </button>
            <button className="btn-danger text-xs py-1" onClick={() => bulkUpdate('rejected')} disabled={bulkWorking}>
              Reject
            </button>
          </div>
          {bulkWorking && <span className="text-gray-400 text-xs">Processing…</span>}
        </div>
      )}

      {error && <ErrorMsg error={error} />}

      <div className="px-6 pb-8">
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="th w-10">
                  <button onClick={toggleAll} className="text-gray-400 hover:text-navy-700">
                    {selected.size === referrals.length && referrals.length > 0
                      ? <CheckSquare size={15} />
                      : <Square size={15} />}
                  </button>
                </th>
                {['Order', 'Date', 'Affiliate', 'Coupon', 'WC #', 'Commission', 'Status', 'Actions'].map(h =>
                  <th key={h} className="th">{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={9}><Spinner /></td></tr>
                : referrals.length === 0
                  ? <tr><td colSpan={9}><Empty label="No commissions for these filters" /></td></tr>
                  : referrals.map(r => {
                    const id = rowKey(r)
                    return (
                      <tr key={id} className={`tr-hover ${selected.has(id) ? 'bg-blue-50' : ''}`}>
                        <td className="td">
                          <button onClick={() => toggleSelect(id)} className="text-gray-400 hover:text-navy-700">
                            {selected.has(id) ? <CheckSquare size={15} className="text-navy-700" /> : <Square size={15} />}
                          </button>
                        </td>
                        <td className="td font-mono text-xs">{r.salesorder_number || `#${r.referral_id}`}</td>
                        <td className="td text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="td text-xs max-w-[140px] truncate" title={affLabel(r)}>
                          {r.affiliate_id ? (
                            <a href={`/affiliates/${r.affiliate_id}`} className="text-navy-500 hover:underline">
                              {affLabel(r)}
                            </a>
                          ) : affLabel(r)}
                        </td>
                        <td className="td font-mono text-xs">{r.coupon_code || '—'}</td>
                        <td className="td font-mono text-xs">{r.reference || '—'}</td>
                        <td className="td font-semibold text-sm whitespace-nowrap">{fmt(r.amount)}</td>
                        <td className="td"><StatusBadge status={r.status} /></td>
                        <td className="td">
                          <div className="flex items-center gap-0.5">
                            {r.status !== 'paid' && (
                              <button className="btn-ghost text-green-700 text-xs py-0.5 px-1.5"
                                onClick={() => updateOne(r, 'paid')}>Pay</button>
                            )}
                            {r.status === 'paid' && (
                              <button className="btn-ghost text-xs py-0.5 px-1.5 text-gray-500"
                                onClick={() => updateOne(r, 'unpaid')}>Undo</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>
            Page {page} of {pages} · {total} total
            {openTotal > 0 && status !== 'paid' ? ` · ${fmt(openTotal)} on this page open` : ''}
          </span>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
              <ChevronLeft size={14} /> Previous
            </button>
            <button className="btn-outline" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
