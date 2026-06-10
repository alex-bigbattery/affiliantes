import { useState, useEffect } from 'react'
import { api, fmt, fmtDate } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatusBadge, Modal, Empty } from '../components/Layout'
import { Plus, Trash2 } from 'lucide-react'
import ExportButtons from '../components/ExportButtons'

export default function Payouts() {
  const [payouts, setPayouts]     = useState([])
  const [affiliates, setAffiliates] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filters, setFilters]     = useState({ affiliate_id: '', date: '', end_date: '' })

  const load = () => {
    setLoading(true)
    const p = { number: 100 }
    if (filters.affiliate_id) p.affiliate_id = filters.affiliate_id
    if (filters.date)         p.date         = filters.date
    if (filters.end_date)     p.end_date     = filters.end_date
    api.payouts(p)
      .then(d => setPayouts(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filters])
  useEffect(() => {
    api.affiliates({ number: 100 }).then(d => setAffiliates(Array.isArray(d) ? d : []))
  }, [])

  const handleDelete = async (id) => {
    if (!confirm(`Delete payout #${id}?`)) return
    try { await api.deletePayout(id); setPayouts(prev => prev.filter(p => p.payout_id !== id)) }
    catch (e) { alert(e.message) }
  }

  const total = payouts.reduce((s, p) => s + parseFloat(p.amount || 0), 0)

  const affName = id => affiliates.find(a => a.affiliate_id === id)?.display_name
    || affiliates.find(a => a.affiliate_id === id)?.payment_email || `#${id}`
  const exportColumns = [
    { header: 'Payout ID', value: p => p.payout_id },
    { header: 'Date',      value: p => p.date },
    { header: 'Affiliate', value: p => affName(p.affiliate_id) },
    { header: 'Amount',    value: p => Number(p.amount || 0) },
    { header: 'Method',    value: p => p.payout_method || '' },
    { header: 'Status',    value: p => p.status || 'paid' },
  ]

  return (
    <div>
      <PageHeader
        title="Payouts"
        subtitle={`${payouts.length} payouts · Total: ${fmt(total)}`}
        actions={
          <>
            <ExportButtons baseName="payouts" sheetName="Payouts" columns={exportColumns} rows={payouts} />
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> Record payout
            </button>
          </>
        }
      />

      {/* Filters */}
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
                {['Payout ID','Date','Affiliate','Amount','Method','Status','Actions'].map(h =>
                  <th key={h} className="th">{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={7}><Spinner /></td></tr>
                : payouts.length === 0
                  ? <tr><td colSpan={7}><Empty /></td></tr>
                  : payouts.map(p => (
                    <tr key={p.payout_id} className="tr-hover">
                      <td className="td font-mono text-xs">#{p.payout_id}</td>
                      <td className="td text-gray-500">{fmtDate(p.date)}</td>
                      <td className="td">
                        <a href={`/affiliates/${p.affiliate_id}`} className="text-navy-500 hover:underline text-sm">
                          {affiliates.find(a => a.affiliate_id === p.affiliate_id)?.display_name
                            || affiliates.find(a => a.affiliate_id === p.affiliate_id)?.payment_email
                            || `#${p.affiliate_id}`}
                        </a>
                      </td>
                      <td className="td font-semibold text-green-700">{fmt(p.amount)}</td>
                      <td className="td text-gray-500 text-sm">{p.payout_method || '—'}</td>
                      <td className="td"><StatusBadge status={p.status || 'paid'} /></td>
                      <td className="td">
                        <button className="btn-ghost p-1.5 text-red-500" onClick={() => handleDelete(p.payout_id)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreatePayoutModal
          affiliates={affiliates}
          onClose={() => setShowCreate(false)}
          onSave={async (d) => { await api.createPayout(d); setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function CreatePayoutModal({ affiliates, onClose, onSave }) {
  const [form, setForm] = useState({ affiliate_id: '', amount: '', payout_method: 'manual' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true); setErr(null)
    try { await onSave(form) }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Record new payout" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Affiliate *</label>
          <select className="select" required value={form.affiliate_id} onChange={e => set('affiliate_id', e.target.value)}>
            <option value="">Select affiliate...</option>
            {affiliates.map(a => (
              <option key={a.affiliate_id} value={a.affiliate_id}>
                #{a.affiliate_id} — {a.display_name || a.username || a.payment_email || `user ${a.user_id}`}
                {a.unpaid_earnings > 0 ? ` (unpaid: ${parseFloat(a.unpaid_earnings).toFixed(2)})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Amount *</label>
          <input className="input" type="number" step="0.01" required value={form.amount}
            onChange={e => set('amount', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="label">Payout method</label>
          <select className="select" value={form.payout_method} onChange={e => set('payout_method', e.target.value)}>
            <option value="manual">Manual</option>
            <option value="check">Check</option>
            <option value="paypal">PayPal</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="payoneer">Payoneer</option>
            <option value="venmo">Venmo</option>
            <option value="zelle">Zelle</option>
          </select>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Recording...' : 'Record payout'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
