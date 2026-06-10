import { useEffect, useState } from 'react'
import { PageHeader } from '../components/Layout'
import { RefreshCw, Database, CheckCircle, XCircle, Clock } from 'lucide-react'
import { api } from '../api'

export default function Sync() {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)

  const load = () =>
    api.syncStatus()
      .then(d => { setInfo(d); setLoading(false) })
      .catch(() => setLoading(false))

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])

  const triggerSync = async () => {
    setTriggering(true)
    await Promise.all([api.runSync(), api.runWooSync()])
    setTimeout(() => { load(); setTriggering(false) }, 1500)
  }

  const running = info?.running || info?.woo?.running || triggering

  const fmt = iso => iso
    ? new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })
    : '—'

  const dur = (start, end) => {
    if (!start || !end) return '—'
    const s = Math.round((new Date(end) - new Date(start)) / 1000)
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  }

  return (
    <div>
      <PageHeader
        title="Supabase Sync"
        subtitle="AffiliateWP + WooCommerce coupons are copied to Supabase every 30 minutes"
        actions={
          <button
            onClick={triggerSync}
            disabled={running}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
            {running ? 'Syncing…' : 'Sync now'}
          </button>
        }
      />

      <div className="px-6 space-y-6">
        {/* Status cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Affiliates', key: 'affiliates_synced', icon: '👤' },
            { label: 'Referrals', key: 'referrals_synced',  icon: '🔗' },
            { label: 'Payouts',   key: 'payouts_synced',    icon: '💰' },
            { label: 'Visits',    key: 'visits_synced',     icon: '👁' },
          ].map(({ label, key, icon }) => (
            <div key={key} className="card px-5 py-4">
              <div className="text-2xl mb-1">{icon}</div>
              <div className="text-2xl font-bold text-navy-700">
                {info?.last?.[key] ?? '—'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{label} in last sync</div>
            </div>
          ))}
        </div>

        <div className="card px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">WooCommerce coupons</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Last sync: {fmt(info?.woo?.last?.finished_at)}
              {info?.woo?.last?.coupons != null && ` · ${info.woo.last.coupons} codes`}
            </div>
          </div>
          <div className="text-2xl font-bold text-navy-700">
            {info?.woo?.last?.coupons ?? '—'}
          </div>
        </div>

        {/* Sync log */}
        <div className="card">
          <div className="px-5 py-4 border-b flex items-center gap-2">
            <Database size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">AffiliateWP sync history</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : !info?.log?.length ? (
            <div className="p-8 text-center text-gray-400 text-sm">No history yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Start</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">End</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Duration</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Affiliates</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Referrals</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Payouts</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {info.log.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-700">{fmt(row.started_at)}</td>
                    <td className="px-5 py-3 text-gray-700">{fmt(row.finished_at)}</td>
                    <td className="px-5 py-3 text-gray-500">{dur(row.started_at, row.finished_at)}</td>
                    <td className="px-5 py-3 text-gray-700">{row.affiliates_synced ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-700">{row.referrals_synced ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-700">{row.payouts_synced ?? '—'}</td>
                    <td className="px-5 py-3">
                      {row.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <CheckCircle size={13} /> OK
                        </span>
                      ) : row.status === 'running' && info?.running && row.id === info.log[0]?.id ? (
                        <span className="inline-flex items-center gap-1 text-yellow-600">
                          <Clock size={13} className="animate-pulse" /> In progress
                        </span>
                      ) : row.status === 'running' || row.status === 'interrupted' ? (
                        <span className="inline-flex items-center gap-1 text-gray-500">
                          <XCircle size={13} /> Interrupted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600" title={row.error}>
                          <XCircle size={13} /> Error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Info box */}
        <div className="card px-5 py-4 bg-blue-50 border-blue-100">
          <h3 className="font-semibold text-blue-900 text-sm mb-2">How it works</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>The backend copies AffiliateWP data and WooCommerce coupons to Supabase on startup and every 30 minutes</li>
            <li>All read queries go to Supabase (no API limits)</li>
            <li>Edits (create/update/delete) go to AffiliateWP and then update Supabase</li>
            <li>You can force an immediate sync with the "Sync now" button</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
