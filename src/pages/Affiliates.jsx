import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api, fmt } from '../api'
import { PageHeader, Spinner, ErrorMsg, StatusBadge, Modal } from '../components/Layout'
import { Search, Plus, Edit2, Trash2, Eye } from 'lucide-react'
import ExportButtons from '../components/ExportButtons'

const EXPORT_COLUMNS = [
  { header: 'ID',            value: a => a.affiliate_id },
  { header: 'Name',          value: a => a.display_name || a.username || '' },
  { header: 'Payout email',  value: a => a.payment_email || '' },
  { header: 'Rate',          value: a => a.rate },
  { header: 'Type',          value: a => a.rate_type },
  { header: 'Unpaid',        value: a => Number(a.unpaid_earnings || 0) },
  { header: 'Total earnings', value: a => Number(a.earnings || 0) },
  { header: 'Referrals',     value: a => Number(a.referrals || 0) },
  { header: 'Status',        value: a => a.status },
]

const RATE_TYPES = ['percentage', 'flat']

export default function Affiliates() {
  const [affiliates, setAffiliates] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [search, setSearch]         = useState('')
  const [status, setStatus]         = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  const load = () => {
    setLoading(true)
    api.affiliates({ number: 100, status: status || undefined, search: search || undefined })
      .then(d => setAffiliates(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status])

  const handleSearch = e => {
    e.preventDefault()
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm(`Delete affiliate ID ${id}? This action cannot be undone.`)) return
    try {
      await api.deleteAffiliate(id)
      setAffiliates(prev => prev.filter(a => a.affiliate_id !== id))
    } catch (e) { alert('Error: ' + e.message) }
  }

  return (
    <div>
      <PageHeader
        title="Affiliates"
        subtitle={`${affiliates.length} records loaded`}
        actions={
          <>
            <ExportButtons baseName="affiliates" sheetName="Affiliates" columns={EXPORT_COLUMNS} rows={affiliates} />
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> New affiliate
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-sm">
          <input className="input" placeholder="Search name, email..." value={search} onChange={e => setSearch(e.target.value)} />
          <button type="submit" className="btn-outline"><Search size={14} /></button>
        </form>
        <select className="select w-40" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {error && <ErrorMsg error={error} />}

      <div className="px-6 pb-8">
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                {['ID','Payout email','Rate','Type','Unpaid','Total earnings','Referrals','Status','Actions'].map(h =>
                  <th key={h} className="th">{h}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading
                ? <tr><td colSpan={9}><Spinner /></td></tr>
                : affiliates.length === 0
                  ? <tr><td colSpan={9} className="td text-center text-gray-400 py-10">No results</td></tr>
                  : affiliates.map(a => (
                    <tr key={a.affiliate_id} className="tr-hover">
                      <td className="td font-mono text-xs text-gray-400">#{a.affiliate_id}</td>
                      <td className="td">
                        <div className="text-sm font-medium">{a.display_name || a.username || a.payment_email || '—'}</div>
                        <div className="text-xs text-gray-400">{a.payment_email || `user #${a.user_id}`}</div>
                      </td>
                      <td className="td font-semibold">
                        {a.rate_type === 'percentage' ? `${a.rate}%` : fmt(a.rate)}
                      </td>
                      <td className="td text-gray-500 text-xs">{a.rate_type}</td>
                      <td className="td font-semibold text-red-700">{fmt(a.unpaid_earnings)}</td>
                      <td className="td">{fmt(a.earnings)}</td>
                      <td className="td text-center">{a.referrals}</td>
                      <td className="td"><StatusBadge status={a.status} /></td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          <Link to={`/affiliates/${a.affiliate_id}`}
                            className="btn-ghost p-1.5 text-navy-700" title="View detail">
                            <Eye size={14} />
                          </Link>
                          <button className="btn-ghost p-1.5 text-gray-500" title="Edit"
                            onClick={() => setEditTarget(a)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn-ghost p-1.5 text-red-500" title="Delete"
                            onClick={() => handleDelete(a.affiliate_id)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <AffiliateForm
          title="New affiliate"
          onClose={() => setShowCreate(false)}
          onSave={async (d) => { await api.createAffiliate(d); setShowCreate(false); load() }}
        />
      )}
      {editTarget && (
        <AffiliateForm
          title={`Edit affiliate #${editTarget.affiliate_id}`}
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async (d) => { await api.updateAffiliate(editTarget.affiliate_id, d); setEditTarget(null); load() }}
        />
      )}
    </div>
  )
}

function AffiliateForm({ title, initial = {}, onClose, onSave }) {
  const [form, setForm] = useState({
    payment_email: initial.payment_email || '',
    rate:          initial.rate          || '',
    rate_type:     initial.rate_type     || 'percentage',
    status:        initial.status        || 'active',
    user_id:       initial.user_id       || '',
  })
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
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!initial.user_id && (
          <div>
            <label className="label">WordPress User ID *</label>
            <input className="input" type="number" required value={form.user_id} onChange={e => set('user_id', e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">Payout email</label>
          <input className="input" type="email" value={form.payment_email} onChange={e => set('payment_email', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Rate</label>
            <input className="input" type="number" step="0.01" value={form.rate} onChange={e => set('rate', e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="select" value={form.rate_type} onChange={e => set('rate_type', e.target.value)}>
              {RATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="select" value={form.status} onChange={e => set('status', e.target.value)}>
            {['active','inactive','pending'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
