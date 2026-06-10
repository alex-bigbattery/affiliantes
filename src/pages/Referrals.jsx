import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatusBadge, Empty } from '../components/Layout'
import { Filter, CheckSquare, Square, ChevronLeft, ChevronRight, Download } from 'lucide-react'

const STATUSES = ['all','unpaid','paid','pending','rejected']
const PAGE_SIZE = 50

export default function Referrals() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [referrals, setReferrals]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [selected, setSelected]     = useState(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [affiliates, setAffiliates] = useState([])
  const [offset, setOffset]         = useState(0)

  const status    = searchParams.get('status')    || 'all'
  const affId     = searchParams.get('affiliate') || ''
  const dateFrom  = searchParams.get('from')      || ''
  const dateTo    = searchParams.get('to')        || ''

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
      number:     PAGE_SIZE,
      offset,
      orderby:    'referral_id',
      order:      'DESC',
    }
    if (status && status !== 'all') params.status       = status
    if (affId)                       params.affiliate_id = affId
    if (dateFrom)                    params.date         = dateFrom
    if (dateTo)                      params.end_date     = dateTo

    api.referrals(params)
      .then(d => { setReferrals(Array.isArray(d) ? d : []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, affId, dateFrom, dateTo, offset])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.affiliates({ number: 100 }).then(d => setAffiliates(Array.isArray(d) ? d : []))
  }, [])

  const toggleSelect = id => setSelected(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })
  const toggleAll = () =>
    setSelected(selected.size === referrals.length ? new Set() : new Set(referrals.map(r => r.referral_id)))

  const bulkUpdate = async (newStatus) => {
    if (!selected.size) return
    if (!confirm(`Change ${selected.size} referrals to "${newStatus}"?`)) return
    setBulkWorking(true)
    try {
      await api.bulkReferrals([...selected], newStatus)
      setSelected(new Set())
      load()
    } catch (e) { alert(e.message) }
    finally { setBulkWorking(false) }
  }

  const updateOne = async (id, newStatus) => {
    try {
      await api.updateReferral(id, { status: newStatus })
      setReferrals(prev => prev.map(r => r.referral_id === id ? { ...r, status: newStatus } : r))
    } catch (e) { alert(e.message) }
  }

  const deleteOne = async (id) => {
    if (!confirm(`Delete referral #${id}?`)) return
    try {
      await api.deleteReferral(id)
      setReferrals(prev => prev.filter(r => r.referral_id !== id))
    } catch (e) { alert(e.message) }
  }

  const exportCSV = () => {
    const rows = [['ID','Date','Affiliate ID','Reference','Description','Amount','Status']]
    referrals.forEach(r => rows.push([r.referral_id, r.date, r.affiliate_id, r.reference, r.description, r.amount, r.status]))
    const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv,' + encodeURIComponent(csv)
    a.download = `referrals_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  const totalUnpaid = referrals.filter(r => r.status === 'unpaid').reduce((s, r) => s + parseFloat(r.amount || 0), 0)

  return (
    <div>
      <PageHeader
        title="Referrals"
        subtitle={`${referrals.length} records loaded${totalUnpaid > 0 ? ` · ${fmt(totalUnpaid)} pending payment` : ''}`}
        actions={
          <button className="btn-outline" onClick={exportCSV}>
            <Download size={14} /> Export CSV
          </button>
        }
      />

      {/* Status tabs */}
      <div className="flex gap-1 border-b mx-6 mb-4">
        {STATUSES.map(s => (
          <button key={s} onClick={() => set('status', s === 'all' ? '' : s)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              status === (s === 'all' ? '' : s) || (s === 'all' && !status)
                ? 'border-navy-700 text-navy-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {/* Filters */}
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

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="mx-6 mb-3 px-4 py-2.5 bg-navy-50 border border-navy-100 rounded-lg flex items-center gap-3 text-sm">
          <span className="font-medium text-navy-700">{selected.size} selected</span>
          <div className="flex gap-2">
            <button className="btn-primary text-xs py-1" onClick={() => bulkUpdate('paid')} disabled={bulkWorking}>
              ✓ Mark paid
            </button>
            <button className="btn-outline text-xs py-1" onClick={() => bulkUpdate('unpaid')} disabled={bulkWorking}>
              Mark unpaid
            </button>
            <button className="btn-danger text-xs py-1" onClick={() => bulkUpdate('rejected')} disabled={bulkWorking}>
              Reject
            </button>
          </div>
          {bulkWorking && <span className="text-gray-400 text-xs">Processing...</span>}
        </div>
      )}

      {error && <ErrorMsg error={error} />}

      <div className="px-6 pb-8">
        <div className="card overflow-hidden">
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
                {['ID','Date','Affiliate','WC Reference','Description','Amount','Status','Actions'].map(h =>
                  <th key={h} className="th">{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={9}><Spinner /></td></tr>
                : referrals.length === 0
                  ? <tr><td colSpan={9}><Empty label="No referrals for these filters" /></td></tr>
                  : referrals.map(r => (
                    <tr key={r.referral_id} className={`tr-hover ${selected.has(r.referral_id) ? 'bg-blue-50' : ''}`}>
                      <td className="td">
                        <button onClick={() => toggleSelect(r.referral_id)} className="text-gray-400 hover:text-navy-700">
                          {selected.has(r.referral_id) ? <CheckSquare size={15} className="text-navy-700" /> : <Square size={15} />}
                        </button>
                      </td>
                      <td className="td font-mono text-xs">#{r.referral_id}</td>
                      <td className="td text-xs text-gray-500">{fmtDate(r.date)}</td>
                      <td className="td text-xs">
                        <a href={`/affiliates/${r.affiliate_id}`}
                          className="text-navy-500 hover:underline">
                          {affiliates.find(a => a.affiliate_id === r.affiliate_id)?.display_name
                            || affiliates.find(a => a.affiliate_id === r.affiliate_id)?.payment_email
                            || `#${r.affiliate_id}`}
                        </a>
                      </td>
                      <td className="td font-mono text-xs">{r.reference || '—'}</td>
                      <td className="td max-w-xs truncate text-sm" title={r.description}>{r.description || '—'}</td>
                      <td className="td font-semibold text-sm">{fmt(r.amount)}</td>
                      <td className="td"><StatusBadge status={r.status} /></td>
                      <td className="td">
                        <div className="flex items-center gap-0.5">
                          {r.status === 'unpaid' && (
                            <button className="btn-ghost text-green-700 text-xs py-0.5 px-1.5"
                              onClick={() => updateOne(r.referral_id, 'paid')}>Pay</button>
                          )}
                          {r.status === 'paid' && (
                            <button className="btn-ghost text-xs py-0.5 px-1.5 text-gray-500"
                              onClick={() => updateOne(r.referral_id, 'unpaid')}>↩</button>
                          )}
                          {r.status === 'pending' && (
                            <>
                              <button className="btn-ghost text-green-700 text-xs py-0.5 px-1.5"
                                onClick={() => updateOne(r.referral_id, 'unpaid')}>✓</button>
                              <button className="btn-ghost text-red-600 text-xs py-0.5 px-1.5"
                                onClick={() => updateOne(r.referral_id, 'rejected')}>✗</button>
                            </>
                          )}
                          <button className="btn-ghost text-red-400 text-xs py-0.5 px-1.5"
                            onClick={() => deleteOne(r.referral_id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>Showing {referrals.length} records (offset {offset})</span>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
              <ChevronLeft size={14} /> Previous
            </button>
            <button className="btn-outline" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={referrals.length < PAGE_SIZE}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
