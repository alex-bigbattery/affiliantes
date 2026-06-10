import { useState, useEffect } from 'react'
import { api, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, Empty } from '../components/Layout'

export default function Visits() {
  const [visits, setVisits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [filters, setFilters] = useState({ affiliate_id: '', date: '', end_date: '' })
  const [affiliates, setAffiliates] = useState([])

  useEffect(() => {
    api.affiliates({ number: 100 }).then(d => setAffiliates(Array.isArray(d) ? d : []))
  }, [])

  useEffect(() => {
    setLoading(true)
    const p = { number: 100 }
    if (filters.affiliate_id) p.affiliate_id = filters.affiliate_id
    if (filters.date)         p.date         = filters.date
    if (filters.end_date)     p.end_date     = filters.end_date
    api.visits(p)
      .then(d => setVisits(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [filters])

  return (
    <div>
      <PageHeader title="Visits" subtitle={`${visits.length} visits loaded`} />

      <div className="flex flex-wrap gap-3 px-6 mb-4">
        <select className="select w-52" value={filters.affiliate_id}
          onChange={e => setFilters(p => ({ ...p, affiliate_id: e.target.value }))}>
          <option value="">All affiliates</option>
          {affiliates.map(a => (
            <option key={a.affiliate_id} value={a.affiliate_id}>
              #{a.affiliate_id} — {a.display_name || a.username || a.payment_email || `user ${a.user_id}`}
            </option>
          ))}
        </select>
        <input type="date" className="input w-40" value={filters.date}
          onChange={e => setFilters(p => ({ ...p, date: e.target.value }))} />
        <span className="self-center text-gray-400 text-sm">to</span>
        <input type="date" className="input w-40" value={filters.end_date}
          onChange={e => setFilters(p => ({ ...p, end_date: e.target.value }))} />
      </div>

      {error && <ErrorMsg error={error} />}

      <div className="px-6 pb-8">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {['ID','Date','Affiliate','URL','Referrer','Conversion'].map(h =>
                  <th key={h} className="th">{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={6}><Spinner /></td></tr>
                : visits.length === 0
                  ? <tr><td colSpan={6}><Empty label="No visits recorded" /></td></tr>
                  : visits.map(v => (
                    <tr key={v.visit_id} className="tr-hover">
                      <td className="td font-mono text-xs">#{v.visit_id}</td>
                      <td className="td text-xs text-gray-500">{fmtDate(v.date)}</td>
                      <td className="td text-sm">#{v.affiliate_id}</td>
                      <td className="td text-xs text-gray-500 max-w-xs truncate" title={v.url}>{v.url || '—'}</td>
                      <td className="td text-xs text-gray-500 max-w-xs truncate" title={v.referrer}>{v.referrer || '—'}</td>
                      <td className="td">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          v.referral_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {v.referral_id ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
