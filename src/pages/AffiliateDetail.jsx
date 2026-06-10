import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatusBadge, StatCard } from '../components/Layout'
import { ArrowLeft, Mail, DollarSign, TrendingUp } from 'lucide-react'

export default function AffiliateDetail() {
  const { id }   = useParams()
  const [aff, setAff]   = useState(null)
  const [refs, setRefs] = useState([])
  const [pays, setPays] = useState([])
  const [tab, setTab]   = useState('referrals')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    Promise.all([
      api.affiliate(id),
      api.referrals({ affiliate_id: id, number: 100, orderby: 'referral_id', order: 'DESC' }),
      api.payouts({ affiliate_id: id, number: 100 })
    ])
      .then(([a, r, p]) => { setAff(a); setRefs(Array.isArray(r) ? r : []); setPays(Array.isArray(p) ? p : []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const updateRefStatus = async (refId, status) => {
    try {
      await api.updateReferral(refId, { status })
      setRefs(prev => prev.map(r => r.referral_id === refId ? { ...r, status } : r))
    } catch (e) { alert(e.message) }
  }

  if (loading) return <Spinner />
  if (error)   return <ErrorMsg error={error} />
  if (!aff)    return <ErrorMsg error="Affiliate not found" />

  return (
    <div>
      <div className="px-6 pt-5 pb-2">
        <Link to="/affiliates" className="flex items-center gap-1 text-sm text-gray-500 hover:text-navy-700 mb-3">
          <ArrowLeft size={14} /> Back to affiliates
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {aff.display_name || aff.username || `Affiliate #${aff.affiliate_id}`}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              {aff.payment_email && (
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Mail size={13} /> {aff.payment_email}
                </span>
              )}
              <StatusBadge status={aff.status} />
              <span className="text-sm text-gray-500">
                Rate: <strong>{aff.rate_type === 'percentage' ? `${aff.rate}%` : fmt(aff.rate)}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 px-6 my-4">
        <StatCard label="Unpaid" value={fmt(aff.unpaid_earnings)} color="text-red-600" />
        <StatCard label="Total earned" value={fmt(aff.earnings)} />
        <StatCard label="Total referrals" value={aff.referrals} />
        <StatCard label="Payouts issued" value={pays.length}
          sub={fmt(pays.reduce((s, p) => s + parseFloat(p.amount || 0), 0))} />
      </div>

      {/* Tabs */}
      <div className="px-6">
        <div className="flex gap-1 border-b mb-4">
          {['referrals','payouts'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                tab === t ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'referrals' ? `Referrals (${refs.length})` : `Payouts (${pays.length})`}
            </button>
          ))}
        </div>

        {tab === 'referrals' && (
          <div className="card overflow-hidden mb-8">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  {['ID','Date','Reference','Description','Amount','Status','Actions'].map(h =>
                    <th key={h} className="th">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {refs.length === 0
                  ? <tr><td colSpan={7} className="td text-center text-gray-400 py-8">No referrals</td></tr>
                  : refs.map(r => (
                    <tr key={r.referral_id} className="tr-hover">
                      <td className="td font-mono text-xs">#{r.referral_id}</td>
                      <td className="td text-gray-500 text-xs">{fmtDate(r.date)}</td>
                      <td className="td font-mono text-xs">{r.reference || '—'}</td>
                      <td className="td max-w-xs truncate text-sm">{r.description || '—'}</td>
                      <td className="td font-semibold">{fmt(r.amount)}</td>
                      <td className="td"><StatusBadge status={r.status} /></td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          {r.status === 'unpaid' && (
                            <button className="btn-ghost text-green-700 text-xs py-1"
                              onClick={() => updateRefStatus(r.referral_id, 'paid')}>
                              ✓ Pay
                            </button>
                          )}
                          {r.status === 'paid' && (
                            <button className="btn-ghost text-gray-500 text-xs py-1"
                              onClick={() => updateRefStatus(r.referral_id, 'unpaid')}>
                              ↩ Unmark
                            </button>
                          )}
                          {r.status === 'pending' && (
                            <>
                              <button className="btn-ghost text-green-700 text-xs py-1"
                                onClick={() => updateRefStatus(r.referral_id, 'unpaid')}>
                                Accept
                              </button>
                              <button className="btn-ghost text-red-600 text-xs py-1"
                                onClick={() => updateRefStatus(r.referral_id, 'rejected')}>
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}

        {tab === 'payouts' && (
          <div className="card overflow-hidden mb-8">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  {['ID','Date','Amount','Method','Status'].map(h =>
                    <th key={h} className="th">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pays.length === 0
                  ? <tr><td colSpan={5} className="td text-center text-gray-400 py-8">No payouts</td></tr>
                  : pays.map(p => (
                    <tr key={p.payout_id} className="tr-hover">
                      <td className="td font-mono text-xs">#{p.payout_id}</td>
                      <td className="td text-gray-500">{fmtDate(p.date)}</td>
                      <td className="td font-semibold text-green-700">{fmt(p.amount)}</td>
                      <td className="td text-gray-500 text-sm">{p.payout_method || '—'}</td>
                      <td className="td"><StatusBadge status={p.status || 'paid'} /></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
